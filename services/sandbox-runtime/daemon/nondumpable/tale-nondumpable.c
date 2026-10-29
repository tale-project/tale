/*
 * tale-nondumpable — the Node addon runnerd makes itself non-dumpable with.
 *
 * runnerd holds the session's token, and every exec runs at runnerd's own
 * uid. While a process is dumpable, any other process of its uid may read its
 * /proc/<pid>/environ, mem, fd/ and maps, and attach to it with ptrace; the
 * kernel makes every process dumpable again when it executes a program, so
 * runnerd, a Node program, clears the flag itself, through this addon, before
 * it reads its token (daemon/src/runnerd-token.ts). The /proc entries of a
 * process that is not dumpable belong to root, and ptrace, process_vm_readv
 * and pidfd_getfd from its uid are refused. The flag also keeps the kernel
 * from writing a core dump of runnerd, which would hold the token.
 *
 *   setNonDumpable()  clears the flag (prctl PR_SET_DUMPABLE 0), or throws
 *                     an Error with the errno's message
 *   isDumpable()      whether processes of its uid may read it: the flag
 *                     reads 1 (SUID_DUMP_USER), not 0 or the 2 a host's
 *                     fs.suid_dumpable may leave after a uid change
 *
 * Built in the image's exec-shim-build stage against the image's own Node
 * headers, and loaded with process.dlopen; Node-API keeps it working with
 * any Node of the same or a later Node-API version.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <stdbool.h>
#include <string.h>
#include <sys/prctl.h>

#include <node_api.h>

static napi_value set_non_dumpable(napi_env env, napi_callback_info info) {
  (void)info;
  if (prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0)
    napi_throw_error(env, NULL, strerror(errno));
  return NULL;
}

static napi_value is_dumpable(napi_env env, napi_callback_info info) {
  (void)info;
  int dumpable = prctl(PR_GET_DUMPABLE, 0, 0, 0, 0);
  if (dumpable < 0) {
    napi_throw_error(env, NULL, strerror(errno));
    return NULL;
  }
  napi_value result;
  if (napi_get_boolean(env, dumpable == 1, &result) != napi_ok) return NULL;
  return result;
}

static bool export_function(napi_env env, napi_value exports, const char *name,
                            napi_callback callback) {
  napi_value function;
  return napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, NULL,
                              &function) == napi_ok &&
         napi_set_named_property(env, exports, name, function) == napi_ok;
}

NAPI_MODULE_INIT() {
  if (!export_function(env, exports, "setNonDumpable", set_non_dumpable) ||
      !export_function(env, exports, "isDumpable", is_dumpable))
    return NULL;
  return exports;
}
