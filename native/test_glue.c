/*
 * test_glue.c - native check of the ENU conventions in earthflyer_fpv.c.
 * Build against a native libfpv (see native/README in the repo):
 *   cc -O1 -I<libfpv>/include test_glue.c earthflyer_fpv.c -L<build> -lfpv -lm -o test_glue
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <math.h>
#include <stdio.h>
#include <time.h>

#include "libfpv.h"

int ef_init(void);
int ef_load_mesh(const float *, unsigned, const unsigned *, unsigned, const unsigned char *);
int ef_spawn(float, float, float, float);
float *ef_tick(float);
const char *ef_arming_text(void);
const char *ef_last_error(void);
void ef_set_infinite_battery(int);
void ef_set_unlimited_video(int);

static void sleep_s(double s) {
    struct timespec ts = {(time_t)s, (long)((s - (time_t)s) * 1e9)};
    nanosleep(&ts, NULL);
}

int main(void) {
    if (!ef_init()) { printf("init failed: %s\n", ef_last_error()); return 1; }
    /* 400 m ground plane at z = 0 (ENU: x east, y north, z up). */
    float ground[] = {-5000, -5000, 0, 5000, -5000, 0, 5000, 5000, 0, -5000, 5000, 0};
    unsigned idx[] = {0, 1, 2, 0, 2, 3};
    if (!ef_load_mesh(ground, 4, idx, 2, NULL)) { printf("mesh failed\n"); return 1; }
    if (!ef_spawn(0, 0, 0, (float)(M_PI / 2))) { printf("spawn failed: %s\n", ef_last_error()); return 1; }

    float ch[10] = {0, 0, -1, 0, -1, -1, -1, -1, -1, -1};
    float *s = NULL;
    int fail = 0;
    for (int i = 0; i < 400; i++) { /* 4 s of real time at 100 Hz */
        if (i == 100) ch[4] = 1.0f;   /* AUX1 arm */
        if (i == 160) ch[2] = 0.2f;   /* throttle up */
        if (i == 260) ch[2] = -0.35f; /* ease off */
        fpv_input_set_channels(ch, 10);
        s = ef_tick(0.01f);
        if (i == 20)
            printf("on ground: pos=(%.2f %.2f %.2f) fpv_fwd=(%.2f %.2f %.2f) up=(%.2f %.2f %.2f) fov=%.0f\n",
                   s[0], s[1], s[2], s[15], s[16], s[17], s[18], s[19], s[20], s[21]);
        if (i % 80 == 79)
            printf("t=%.2f flags=0x%x z=%.2f speed=%.1f km/h batt=%.2fV '%s'\n", s[58], (unsigned)s[45], s[2], s[10],
                   s[46], ef_arming_text());
        sleep_s(0.01);
    }
    /* Facing east: camera forward should point mostly +X. */
    if (!(s[15] > 0.5f)) { printf("FAIL: expected camera forward towards east (+X)\n"); fail = 1; }
    if (!(s[2] > 0.5f)) { printf("FAIL: expected the drone to climb along +Z\n"); fail = 1; }
    /* Infinite battery (Earth Flyer patch): keep flying, mAh drawn stays ~0. */
    float drawnBefore = s[48];
    ef_set_infinite_battery(1);
    for (int i = 0; i < 150; i++) { fpv_input_set_channels(ch, 10); s = ef_tick(0.01f); sleep_s(0.01); }
    printf("battery: drawn before=%.1f mAh, with infinite battery=%.2f mAh, %.2f V\n", drawnBefore, s[48], s[46]);
    if (!(drawnBefore > 1.0f && s[48] < 0.5f)) { printf("FAIL: infinite battery did not keep the pack full\n"); fail = 1; }

    /* Video range: 3 km from the pilot is all static, unless unlimited range is on. */
    ef_spawn(3000, 0, 0.02f, 0);
    for (int i = 0; i < 60; i++) { fpv_input_set_channels(ch, 10); s = ef_tick(0.01f); sleep_s(0.01); }
    float farNoise = s[49];
    ef_set_unlimited_video(1);
    for (int i = 0; i < 30; i++) { fpv_input_set_channels(ch, 10); s = ef_tick(0.01f); sleep_s(0.01); }
    printf("video at 3 km: noise=%.2f realistic, %.3f unlimited\n", farNoise, s[49]);
    if (!(farNoise > 0.5f && s[49] < 0.05f)) { printf("FAIL: unlimited video range\n"); fail = 1; }

    printf(fail ? "RESULT: FAIL\n" : "RESULT: PASS\n");
    return fail;
}
