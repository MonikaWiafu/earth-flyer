# Earth Flyer - libfpv WebAssembly bridge.
#
#   emcmake cmake -S native -B build/wasm -DLIBFPV_DIR=path/to/libfpv
#   cmake --build build/wasm -j
#
# Output: web/wasm/earthflyer_fpv.js + earthflyer_fpv.wasm
# SPDX-License-Identifier: GPL-3.0-or-later
cmake_minimum_required(VERSION 3.24)
project(earthflyer_fpv C CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Build this with emcmake (Emscripten): it targets the browser.")
endif()

set(LIBFPV_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/libfpv" CACHE PATH "libfpv source tree")
set(LIBFPV_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LIBFPV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LIBFPV_KAMIKAZE OFF CACHE BOOL "" FORCE)
add_subdirectory(${LIBFPV_DIR} libfpv EXCLUDE_FROM_ALL)

add_executable(earthflyer_fpv earthflyer_fpv.c)
target_link_libraries(earthflyer_fpv PRIVATE libfpv::fpv)
set_target_properties(earthflyer_fpv PROPERTIES SUFFIX ".js"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../web/wasm")
target_link_options(earthflyer_fpv PRIVATE
  -O3
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createEarthFlyerFPV
  -sENVIRONMENT=web
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=67108864
  -sDEFAULT_TO_CXX
  "-sEXPORTED_RUNTIME_METHODS=['HEAPF32','HEAPU8','HEAPU32','UTF8ToString','stringToNewUTF8']"
  "-sEXPORTED_FUNCTIONS=['_main','_malloc','_free']")
