#define _DEFAULT_SOURCE
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/keysym.h>
#include <X11/extensions/XTest.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int x_error;
static int on_error(Display *display, XErrorEvent *error) {
  (void)display;
  x_error = error->error_code;
  return 0;
}

static Window active_window(Display *display) {
  Atom type;
  int format;
  unsigned long count, remaining;
  unsigned char *data = NULL;
  Window result = None;
  Atom property = XInternAtom(display, "_NET_ACTIVE_WINDOW", False);
  if (XGetWindowProperty(display, DefaultRootWindow(display), property, 0, 1,
                         False, XA_WINDOW, &type, &format, &count, &remaining, &data) == Success &&
      data && type == XA_WINDOW && format == 32 && count == 1) result = *(Window *)data;
  if (data) XFree(data);
  return result;
}

static int valid_window(Display *display, Window target) {
  XWindowAttributes attrs;
  x_error = 0;
  int result = target > PointerRoot && target != DefaultRootWindow(display) &&
               XGetWindowAttributes(display, target, &attrs);
  XSync(display, False);
  return result && !x_error && attrs.map_state == IsViewable;
}

static int focus_within(Display *display, Window target) {
  Window focused;
  int revert;
  XGetInputFocus(display, &focused, &revert);
  for (int depth = 0; depth < 32 && focused > PointerRoot; depth++) {
    if (focused == target) return 1;
    Window root, parent, *children = NULL;
    unsigned int count;
    x_error = 0;
    if (!XQueryTree(display, focused, &root, &parent, &children, &count)) return 0;
    if (children) XFree(children);
    if (x_error || parent == focused || parent == root) return 0;
    focused = parent;
  }
  return 0;
}

static int activate_window(Display *display, Window target) {
  if (!valid_window(display, target)) return 0;
  XEvent event = {0};
  event.xclient.type = ClientMessage;
  event.xclient.window = target;
  event.xclient.message_type = XInternAtom(display, "_NET_ACTIVE_WINDOW", False);
  event.xclient.format = 32;
  // A user-invoked window switcher uses the EWMH pager source indication.
  event.xclient.data.l[0] = 2;
  event.xclient.data.l[1] = CurrentTime;
  event.xclient.data.l[2] = (long)active_window(display);
  XSendEvent(display, DefaultRootWindow(display), False,
             SubstructureRedirectMask | SubstructureNotifyMask, &event);
  XFlush(display);
  for (int i = 0; i < 100; i++) {
    if (active_window(display) == target && focus_within(display, target)) return 1;
    usleep(10000);
  }
  return 0;
}

static int is_terminal(Display *display, Window target) {
  XClassHint hint = {0};
  if (!XGetClassHint(display, target, &hint)) return 0;
  char classes[1024];
  snprintf(classes, sizeof(classes), "%s %s", hint.res_name ? hint.res_name : "", hint.res_class ? hint.res_class : "");
  if (hint.res_name) XFree(hint.res_name);
  if (hint.res_class) XFree(hint.res_class);
  for (char *p = classes; *p; ++p) *p = (char)tolower((unsigned char)*p);
  const char *names[] = {"gnome-terminal", "ptyxis", "kgx", "konsole", "xfce4-terminal", "mate-terminal",
                         "tilix", "terminator", "kitty", "alacritty", "wezterm", "ghostty", "guake", "tilda"};
  for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) if (strstr(classes, names[i])) return 1;
  if (strstr(classes, "xterm") || strstr(classes, "urxvt") || strstr(classes, "rxvt")) return 2;
  return 0;
}

static int modifiers_released(Display *display) {
  // Wait for the user to release shortcut keys; never release physical keys for them.
  const KeySym keys[] = {XK_Control_L, XK_Control_R, XK_Shift_L, XK_Shift_R,
                         XK_Alt_L, XK_Alt_R, XK_Super_L, XK_Super_R, XK_v};
  for (int attempt = 0; attempt < 100; attempt++) {
    char state[32];
    int held = 0;
    XQueryKeymap(display, state);
    for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); i++) {
      KeyCode code = XKeysymToKeycode(display, keys[i]);
      if (code && (state[code / 8] & (1 << (code % 8)))) held = 1;
    }
    if (!held) return 1;
    usleep(10000);
  }
  return 0;
}

static int paste(Display *display, Window target) {
  int kind = is_terminal(display, target);
  if (!activate_window(display, target)) { fputs("Target could not be focused\n", stderr); return 4; }
  if (!modifiers_released(display)) { fputs("Shortcut keys still held\n", stderr); return 5; }
  if (active_window(display) != target || !focus_within(display, target)) return 4;
  KeyCode control = XKeysymToKeycode(display, XK_Control_L);
  KeyCode shift = XKeysymToKeycode(display, XK_Shift_L);
  KeyCode key = XKeysymToKeycode(display, kind == 2 ? XK_Insert : XK_v);
  if (!control || !shift || !key) return 6;
  x_error = 0;
  if (kind != 2) XTestFakeKeyEvent(display, control, True, 0);
  if (kind != 0) XTestFakeKeyEvent(display, shift, True, 0);
  XTestFakeKeyEvent(display, key, True, 15);
  XTestFakeKeyEvent(display, key, False, 15);
  if (kind != 0) XTestFakeKeyEvent(display, shift, False, 0);
  if (kind != 2) XTestFakeKeyEvent(display, control, False, 0);
  XSync(display, False);
  if (x_error) return 6;
  printf("target=0x%lx chord=%s injected\n", target, kind == 2 ? "Shift+Insert" : kind ? "Ctrl+Shift+V" : "Ctrl+V");
  return 0;
}

int main(int argc, char **argv) {
  Display *display = XOpenDisplay(NULL);
  if (!display) { fputs("X11 display unavailable\n", stderr); return 1; }
  XSetErrorHandler(on_error);
  if (argc == 2 && strcmp(argv[1], "--focus-id") == 0) {
    printf("0x%lx\n", active_window(display));
    XCloseDisplay(display);
    return 0;
  }
  if (argc == 3 && strcmp(argv[1], "--launch") == 0) {
    char target[32];
    snprintf(target, sizeof(target), "0x%lx", active_window(display));
    XCloseDisplay(display);
    // Local installation uses a stable executable, not an extract-and-run process.
    execl(argv[2], argv[2], "--system-hotkey", "--paste-target", target, (char *)NULL);
    perror("launch");
    return 3;
  }
  if (argc == 3 && strcmp(argv[1], "--target") == 0) {
    char *end;
    Window target = strtoul(argv[2], &end, 0);
    int result = (*end || !valid_window(display, target)) ? 4 : paste(display, target);
    XCloseDisplay(display);
    return result;
  }
  fputs("Usage: linux-paste --focus-id | --launch EXECUTABLE | --target WINDOW\n", stderr);
  XCloseDisplay(display);
  return 2;
}
