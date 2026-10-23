/*
 * earthflyer_fpv.c - thin bridge between libfpv and the Earth Flyer web app.
 *
 * Compiled with Emscripten into web/wasm/earthflyer_fpv.{js,wasm}. The page
 * (web/js/drone/libfpv.js) calls these ef_* functions once per frame.
 *
 * World convention: a local East-North-Up frame in metres whose origin is the
 * spawn point. libfpv is told: right = +X (east), up = +Z, forward = +Y
 * (north), so its simulated GPS/compass agree with the globe.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define EF_DATA_DIR FPV_WEB_DATA_DIR
#else
/* native test builds (native/test_glue.c) */
#define EMSCRIPTEN_KEEPALIVE __attribute__((used, visibility("default")))
#define EF_DATA_DIR "ef_test_data"
#endif

#include "libfpv.h"

#define EF_API EMSCRIPTEN_KEEPALIVE

static fpv_drone *g_drone = NULL;
static fpv_frame g_frame;
static int g_ready = 0;

/* ---- flat state read by JS (Float32Array view) ---------------------------
 * Layout (floats):
 *  0..2   position          3..6   rotation (x y z w)
 *  7..9   velocity          10     speed_kmh       11 altitude (-1 none)
 *  12..14 fpv cam pos       15..17 fpv cam forward 18..20 fpv cam up
 *  21     fpv fov_y deg     22     fpv near        23 fpv aspect hint
 *  24..26 chase cam pos     27..29 chase forward   30..32 chase up
 *  33     chase fov_y       34     chase near
 *  35..37 los cam pos       38..40 los forward     41..43 los up
 *  44     los fov_y
 *  45     flags (as float)  46     battery voltage 47 battery cell voltage
 *  48     mAh drawn         49     video noise     50 video breakup
 *  51     osd revision      52     impact count    53 strongest impact speed
 *  54..57 motor rpm 0..3    58     sim_time
 */
#define EF_STATE_FLOATS 64
static float g_state[EF_STATE_FLOATS];
static char g_text[256];

static void log_cb(void *user, fpv_log_level level, const char *msg) {
    (void)user;
    if (level >= FPV_LOG_INFO) printf("[libfpv] %s\n", msg);
}

static void copy3(float *dst, const float *src) { dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2]; }

EF_API int ef_init(void) {
    if (g_ready) return 1;
    fpv_global_config cfg;
    fpv_global_config_defaults(&cfg);
    cfg.data_dir = EF_DATA_DIR;
    cfg.coords.right = FPV_AXIS_POS_X;   /* east  */
    cfg.coords.up = FPV_AXIS_POS_Z;      /* up    */
    cfg.coords.forward = FPV_AXIS_POS_Y; /* north */
    cfg.coords.units_per_meter = 1.0f;
    cfg.timing = FPV_TIMING_THREAD;      /* web: stepped inside fpv_drone_tick */
    cfg.flags = FPV_INIT_NO_CONFIGURATOR | FPV_INIT_NO_LENS_DISTORTION;
    cfg.log = log_cb;
    if (fpv_global_init(&cfg) != FPV_OK) {
        snprintf(g_text, sizeof g_text, "%s", fpv_last_error());
        return 0;
    }
    /* Material 1: water - kills props. */
    fpv_material water = {0.05f, 0.1f, FPV_MATERIAL_KILLS_PROPS};
    fpv_material_set(1, &water);
    g_frame.struct_size = sizeof(g_frame);
    g_ready = 1;
    return 1;
}

EF_API const char *ef_last_error(void) {
    const char *e = fpv_last_error();
    snprintf(g_text, sizeof g_text, "%s", e ? e : "");
    return g_text;
}

EF_API const char *ef_version(void) { return fpv_version_string(); }

/* Replace the collision mesh (ENU metres). Data is copied by libfpv. */
EF_API int ef_load_mesh(const float *positions, uint32_t vertex_count, const uint32_t *indices,
                        uint32_t triangle_count, const uint8_t *materials) {
    fpv_mesh mesh;
    memset(&mesh, 0, sizeof mesh);
    mesh.positions = positions;
    mesh.vertex_count = vertex_count;
    mesh.indices = indices;
    mesh.triangle_count = triangle_count;
    mesh.materials = materials;
    return fpv_static_surfaces_load(&mesh, 1) == FPV_OK;
}

/* Spawn or teleport. yaw in radians, 0 = facing north, positive = towards east. */
EF_API int ef_spawn(float x, float y, float z, float yaw) {
    if (!g_ready) return 0;
    /* Rotation about the up axis (+Z). Heading east (yaw>0) is a clockwise
     * turn seen from above, i.e. a negative rotation about +Z. */
    float half = -yaw * 0.5f;
    float rot[4] = {0.0f, 0.0f, sinf(half), cosf(half)};
    float pos[3] = {x, y, z};
    if (!g_drone) {
        fpv_drone_desc desc;
        fpv_drone_desc_defaults(&desc);
        copy3(desc.position, pos);
        memcpy(desc.rotation, rot, sizeof rot);
        copy3(desc.pilot_position, pos);
        if (fpv_drone_create(&desc, &g_drone) != FPV_OK) return 0;
    } else {
        fpv_drone_reset(g_drone, pos, rot);
    }
    fpv_gps_set_home(pos);
    return 1;
}

EF_API void ef_repair(void) { if (g_drone) fpv_drone_repair(g_drone); }

EF_API void ef_despawn(void) {
    if (g_drone) fpv_drone_delete(g_drone);
    g_drone = NULL;
}

static void put_cam(float *dst, const fpv_camera *c) {
    copy3(dst + 0, c->position);
    copy3(dst + 3, c->forward);
    copy3(dst + 6, c->up);
}

/* Advance by frame_dt seconds; returns a pointer to g_state. */
EF_API float *ef_tick(float frame_dt) {
    if (!g_drone) return g_state;
    if (fpv_drone_tick(g_drone, frame_dt, &g_frame) != FPV_OK) return g_state;
    const fpv_frame *f = &g_frame;
    copy3(g_state + 0, f->position);
    memcpy(g_state + 3, f->rotation, 4 * sizeof(float));
    copy3(g_state + 7, f->velocity);
    g_state[10] = f->speed_kmh;
    g_state[11] = f->altitude;
    put_cam(g_state + 12, &f->camera);
    g_state[21] = f->camera.fov_y_degrees;
    g_state[22] = f->camera.near_plane;
    g_state[23] = f->camera.aspect_hint;
    put_cam(g_state + 24, &f->chase_camera);
    g_state[33] = f->chase_camera.fov_y_degrees;
    g_state[34] = f->chase_camera.near_plane;
    put_cam(g_state + 35, &f->los_camera);
    g_state[44] = f->los_camera.fov_y_degrees;
    g_state[45] = (float)f->flags;
    g_state[46] = f->battery.voltage;
    g_state[47] = f->battery.cell_voltage;
    g_state[48] = f->battery.mah_drawn;
    g_state[49] = f->video.noise;
    g_state[50] = f->video.breakup;
    g_state[51] = (float)(f->osd_revision & 0xffffff);
    g_state[52] = (float)f->impact_count;
    float strongest = 0.0f;
    for (uint32_t i = 0; i < f->impact_count && i < FPV_MAX_IMPACTS; i++)
        if (f->impacts[i].speed > strongest) strongest = f->impacts[i].speed;
    g_state[53] = strongest;
    for (int i = 0; i < 4; i++) g_state[54 + i] = f->motors[i].rpm;
    g_state[58] = (float)f->sim_time;
    return g_state;
}

EF_API const char *ef_arming_text(void) { return g_frame.arming_disable_text; }

/* ---- OSD: rasterised into an RGBA buffer the page blits to a canvas ------ */
static uint8_t *g_osd = NULL;
static uint32_t g_osd_w = 0, g_osd_h = 0;

EF_API uint8_t *ef_osd_rgba(uint32_t w, uint32_t h, int hd_style) {
    if (!g_drone || w == 0 || h == 0) return NULL;
    if (w != g_osd_w || h != g_osd_h) {
        free(g_osd);
        g_osd = (uint8_t *)malloc((size_t)w * h * 4);
        g_osd_w = w;
        g_osd_h = h;
    }
    if (!g_osd) return NULL;
    if (fpv_osd_render_rgba(&g_frame, g_osd, w, h, w * 4, hd_style ? FPV_OSD_STYLE_HD : FPV_OSD_STYLE_ANALOG) != FPV_OK)
        return NULL;
    return g_osd;
}

/* ---- input ---------------------------------------------------------------- */
EF_API void ef_key(int key, int down) { fpv_input_key(key, down); }

EF_API const char *ef_input_status(void) {
    fpv_input_status s;
    memset(&s, 0, sizeof s);
    s.struct_size = sizeof s;
    fpv_input_get_status(&s);
    snprintf(g_text, sizeof g_text, "%d|%d|%d|%s", (int)s.source, s.needs_setup, s.device_count, s.device_name);
    return g_text;
}

/* ---- overlay (Dear ImGui, F8) flattened for a tiny WebGL2 renderer -------
 * ef_overlay_render() returns the number of draw commands (0 = closed) and
 * fills three buffers the page reads:
 *   vertices: 5 floats each (x, y, u, v, packed RGBA as uint32 bits)
 *   indices:  uint32, already offset into the global vertex array
 *   commands: 6 floats each (clip x1 y1 x2 y2, texture id, index count)
 */
static float *g_ov_v = NULL;  static uint32_t g_ov_v_cap = 0, g_ov_v_n = 0;
static uint32_t *g_ov_i = NULL; static uint32_t g_ov_i_cap = 0, g_ov_i_n = 0;
static float *g_ov_c = NULL;  static uint32_t g_ov_c_cap = 0, g_ov_c_n = 0;

static void *grow(void *p, uint32_t *cap, uint32_t need, size_t elem) {
    if (need <= *cap) return p;
    uint32_t n = *cap ? *cap : 1024;
    while (n < need) n *= 2;
    void *q = realloc(p, (size_t)n * elem);
    if (q) *cap = n;
    return q ? q : p;
}

static uint32_t flatten(const fpv_draw_data *dd) {
    g_ov_v_n = g_ov_i_n = g_ov_c_n = 0;
    if (!dd) return 0;
    g_ov_v = (float *)grow(g_ov_v, &g_ov_v_cap, dd->total_vertex_count * 5, sizeof(float));
    g_ov_i = (uint32_t *)grow(g_ov_i, &g_ov_i_cap, dd->total_index_count, sizeof(uint32_t));
    uint32_t cmd_total = 0;
    for (uint32_t l = 0; l < dd->list_count; l++) cmd_total += dd->lists[l].command_count;
    g_ov_c = (float *)grow(g_ov_c, &g_ov_c_cap, cmd_total * 6, sizeof(float));
    uint32_t vbase = 0;
    for (uint32_t l = 0; l < dd->list_count; l++) {
        const fpv_draw_list *dl = &dd->lists[l];
        for (uint32_t v = 0; v < dl->vertex_count; v++) {
            const fpv_draw_vertex *src = &dl->vertices[v];
            float *dst = g_ov_v + (size_t)(vbase + v) * 5;
            dst[0] = src->pos[0]; dst[1] = src->pos[1];
            dst[2] = src->uv[0];  dst[3] = src->uv[1];
            memcpy(&dst[4], &src->color, 4);
        }
        for (uint32_t c = 0; c < dl->command_count; c++) {
            const fpv_draw_cmd *cmd = &dl->commands[c];
            for (uint32_t k = 0; k < cmd->index_count; k++)
                g_ov_i[g_ov_i_n++] = vbase + cmd->vertex_offset + dl->indices[cmd->index_offset + k];
            float *dst = g_ov_c + (size_t)g_ov_c_n * 6;
            dst[0] = cmd->clip_rect[0]; dst[1] = cmd->clip_rect[1];
            dst[2] = cmd->clip_rect[2]; dst[3] = cmd->clip_rect[3];
            dst[4] = (float)cmd->texture_id;
            dst[5] = (float)cmd->index_count;
            g_ov_c_n++;
        }
        vbase += dl->vertex_count;
    }
    g_ov_v_n = vbase;
    return g_ov_c_n;
}

EF_API uint32_t ef_overlay_render(float frame_dt) { return flatten(fpv_overlay_render(frame_dt)); }
EF_API float *ef_overlay_vertices(void) { return g_ov_v; }
EF_API uint32_t ef_overlay_vertex_count(void) { return g_ov_v_n; }
EF_API uint32_t *ef_overlay_indices(void) { return g_ov_i; }
EF_API uint32_t ef_overlay_index_count(void) { return g_ov_i_n; }
EF_API float *ef_overlay_commands(void) { return g_ov_c; }
EF_API int ef_overlay_is_open(void) { return fpv_overlay_is_open(); }
EF_API int ef_overlay_wants_input(void) { return fpv_overlay_wants_input(); }
EF_API void ef_overlay_set_open(int open) { fpv_overlay_set_open(open); }
EF_API void ef_overlay_display(float w, float h, float scale) { fpv_overlay_set_display(w, h, scale); }
EF_API void ef_overlay_mouse_move(float x, float y) { fpv_overlay_mouse_move(x, y); }
EF_API void ef_overlay_mouse_button(int b, int down) { fpv_overlay_mouse_button(b, down); }
EF_API void ef_overlay_mouse_wheel(float dx, float dy) { fpv_overlay_mouse_wheel(dx, dy); }
EF_API void ef_overlay_text(const char *utf8) { fpv_overlay_text(utf8); }
EF_API void ef_overlay_set_action(uint32_t id, const char *label) { fpv_overlay_set_action(id, label); }
EF_API uint32_t ef_overlay_poll_action(void) { return fpv_overlay_poll_action(); }

/* Textures used by overlay commands: returns rgba pointer, fills dims. */
static uint32_t g_tex_info[3];
EF_API const uint8_t *ef_texture(uint32_t id) {
    fpv_texture t;
    memset(&t, 0, sizeof t);
    if (fpv_texture_get(id, &t) != FPV_OK) return NULL;
    g_tex_info[0] = t.width;
    g_tex_info[1] = t.height;
    g_tex_info[2] = t.revision;
    return t.rgba;
}
EF_API uint32_t *ef_texture_info(void) { return g_tex_info; }

/* ---- audio ------------------------------------------------------------------ */
static float *g_audio = NULL;
static uint32_t g_audio_cap = 0;

EF_API int ef_audio_configure(uint32_t rate) { return fpv_audio_configure(rate, 1) == FPV_OK; }
EF_API float *ef_audio_read(uint32_t frames) {
    if (frames > g_audio_cap) {
        free(g_audio);
        g_audio = (float *)malloc(frames * sizeof(float));
        g_audio_cap = g_audio ? frames : 0;
    }
    if (!g_audio) return NULL;
    fpv_audio_read(g_audio, frames);
    return g_audio;
}
EF_API void ef_audio_volume(float v) { fpv_audio_set_volume(v); }

/* ---- misc ----------------------------------------------------------------- */
EF_API void ef_set_paused(int p) { fpv_set_paused(p); }

/* Earth Flyer options (patches/libfpv-earthflyer.patch adds these to libfpv). */
EF_API void ef_set_infinite_battery(int on) { fpv_battery_set_infinite(on); }
EF_API void ef_set_unlimited_video(int on) { fpv_video_set_unlimited_range(on); }
/* Inverted stick axes, bits: 1 roll, 2 pitch, 4 throttle, 8 yaw. */
EF_API void ef_set_inverted(uint32_t mask) { fpv_input_set_inverted(mask); }
/* Channel as Betaflight sees it (AETR + AUX, -1..1), from the last tick. */
EF_API float ef_channel(int i) { return (i >= 0 && i < FPV_CHANNEL_COUNT) ? g_frame.channels[i] : 0.0f; }

#if defined(__EMSCRIPTEN__)
int main(void) { return 0; }
#endif
