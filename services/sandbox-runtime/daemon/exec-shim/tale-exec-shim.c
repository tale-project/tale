/*
 * tale-exec-shim — runs one exec's command as a child subreaper.
 *
 * runnerd starts every exec through this shim. It registers itself as a
 * child subreaper (PR_SET_CHILD_SUBREAPER), so every process the command
 * starts stays its descendant whatever it does: a process that moves to a
 * session of its own, double-forks or rewrites its environment and title is
 * still reparented here, not to the container's init. runnerd finds an
 * exec's processes by walking down from the shim (process-reaper.ts) and
 * ends them when the exec is over.
 *
 *   tale-exec-shim -- COMMAND [ARG...]
 *
 * File descriptor 3 is a status pipe to runnerd, one line per event:
 *   no-subreaper E  the kernel refused the subreaper (E: errno name)
 *   pid N           the command's pid; it leads a process group of its own
 *   spawn-error E   the command could not be executed (E: errno name)
 *   exit N          the command exited with status N
 *   signal N        the command was ended by signal N
 *
 * The shim keeps none of the command's pipes open, so they close when the
 * command and what it started close them. It ignores SIGTERM, SIGINT and
 * SIGHUP: runnerd signals the command's group and the other descendants,
 * never the shim, and a `pkill -f` aimed at the command, which matches the
 * shim's arguments too, must not take the subreaper away from what the
 * command started. It exits once no descendant is left, with the command's
 * status (128 + N for a command ended by signal N). Without the subreaper (a
 * kernel that refuses it) it still runs the command and reports it.
 *
 * The command runs with an OOM score adjustment of at least 900, above the
 * session container's (and so runnerd's): when the container reaches its
 * memory limit, the kernel's OOM killer picks among the highest scores, and
 * runnerd, whose end ends the container and every exec in it, must not be
 * the one it picks. Raising a score needs no privilege; where the kernel has
 * no such file or refuses the write, the command runs with the score it
 * inherited, and nothing is reported.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define STATUS_FD 3
#define COMMAND_OOM_SCORE_ADJ 900

/* Write one status line; lines are far below PIPE_BUF, so each write is
 * atomic and the command's own spawn-error line never interleaves. */
static void report(const char *line) {
  size_t left = strlen(line);
  while (left > 0) {
    ssize_t written = write(STATUS_FD, line, left);
    if (written < 0) {
      if (errno == EINTR) continue;
      return;
    }
    line += written;
    left -= (size_t)written;
  }
}

/* Report an event that carries an errno name. */
static void report_errno(const char *event, int error) {
  char line[96];
  const char *name = strerrorname_np(error);
  snprintf(line, sizeof line, "%s %s\n", event, name != NULL ? name : "EUNKNOWN");
  report(line);
}

/* Raise this process's OOM score adjustment to at least `target`, never
 * lower it (an operator's higher score stands). Best effort and silent: the
 * exec runs whatever the kernel answers. */
static void raise_oom_score_adj(int target) {
  const char *path = "/proc/self/oom_score_adj";
  char current[16];
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return;
  ssize_t got = read(fd, current, sizeof current - 1);
  close(fd);
  if (got <= 0) return;
  current[got] = '\0';
  if (atoi(current) >= target) return;
  char value[16];
  int length = snprintf(value, sizeof value, "%d\n", target);
  fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd < 0) return;
  ssize_t written = write(fd, value, (size_t)length);
  (void)written;
  close(fd);
}

static void ignore_ending_signals(void) {
  signal(SIGTERM, SIG_IGN);
  signal(SIGINT, SIG_IGN);
  signal(SIGHUP, SIG_IGN);
  signal(SIGPIPE, SIG_IGN);
}

static void default_signals(void) {
  signal(SIGTERM, SIG_DFL);
  signal(SIGINT, SIG_DFL);
  signal(SIGHUP, SIG_DFL);
  signal(SIGPIPE, SIG_DFL);
}

int main(int argc, char **argv) {
  int first = 1;
  if (argc > 1 && strcmp(argv[1], "--") == 0) first = 2;
  if (first >= argc) {
    fprintf(stderr, "usage: tale-exec-shim -- COMMAND [ARG...]\n");
    return 127;
  }
  /* Said on the status pipe, not on stderr: that is the command's output. */
  if (prctl(PR_SET_CHILD_SUBREAPER, 1) != 0) report_errno("no-subreaper", errno);
  /* Blocked across the fork: a signal runnerd sends the command's group
   * before the child has its default dispositions back stays pending
   * instead of being ignored, and ends the child once it unblocks. */
  sigset_t ending, previous;
  sigemptyset(&ending);
  sigaddset(&ending, SIGTERM);
  sigaddset(&ending, SIGINT);
  sigaddset(&ending, SIGHUP);
  sigprocmask(SIG_BLOCK, &ending, &previous);
  ignore_ending_signals();

  pid_t child = fork();
  if (child < 0) {
    report_errno("spawn-error", errno);
    return 127;
  }
  if (child == 0) {
    /* Its own group: the exec's group signals reach the command and what
     * stays in its group, never the shim. Ignored dispositions survive
     * exec, so the command gets the defaults back. */
    setpgid(0, 0);
    default_signals();
    sigprocmask(SIG_SETMASK, &previous, NULL);
    /* The command and everything it starts inherit the higher score; the
     * shim keeps runnerd's. */
    raise_oom_score_adj(COMMAND_OOM_SCORE_ADJ);
    /* The status pipe closes on a successful exec; it stays open only to
     * say why the exec failed. */
    fcntl(STATUS_FD, F_SETFD, FD_CLOEXEC);
    execvp(argv[first], &argv[first]);
    int error = errno;
    report_errno("spawn-error", error);
    _exit(error == ENOENT ? 127 : 126);
  }
  setpgid(child, child);
  /* Ignored, so what arrived while blocked is dropped. */
  sigprocmask(SIG_SETMASK, &previous, NULL);

  char line[64];
  snprintf(line, sizeof line, "pid %d\n", (int)child);
  report(line);

  int devnull = open("/dev/null", O_RDWR);
  if (devnull >= 0) {
    dup2(devnull, STDIN_FILENO);
    dup2(devnull, STDOUT_FILENO);
    dup2(devnull, STDERR_FILENO);
    if (devnull > STDERR_FILENO) close(devnull);
  }

  int reported = 0;
  int code = 127;
  for (;;) {
    int status;
    pid_t ended = waitpid(-1, &status, 0);
    if (ended < 0) {
      if (errno == EINTR) continue;
      break; /* ECHILD: no descendant is left */
    }
    if (ended != child || reported) continue;
    if (WIFEXITED(status)) {
      code = WEXITSTATUS(status);
      snprintf(line, sizeof line, "exit %d\n", code);
    } else if (WIFSIGNALED(status)) {
      code = 128 + WTERMSIG(status);
      snprintf(line, sizeof line, "signal %d\n", WTERMSIG(status));
    } else {
      continue;
    }
    report(line);
    close(STATUS_FD);
    reported = 1;
  }
  return code;
}
