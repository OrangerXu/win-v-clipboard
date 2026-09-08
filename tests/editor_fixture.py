"""A disposable real GTK editor. Only synthetic text enters this window."""
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("GdkX11", "3.0")
from gi.repository import Gtk, GdkX11, GLib
import json, sys

window = Gtk.Window(title="WinV clipboard regression — disposable editor")
window.set_default_size(420, 160)
editor = Gtk.TextView()
window.add(editor)
window.connect("destroy", Gtk.main_quit)
window.show_all()

def reply(value):
    print(json.dumps(value), flush=True)

def focus_reply():
    editor.grab_focus()
    reply({"xid": hex(window.get_window().get_xid())})
    return False

def command(source, condition):
    line = sys.stdin.readline()
    if not line:
        Gtk.main_quit()
        return False
    request = json.loads(line)
    if request["op"] == "reset":
        buffer = editor.get_buffer()
        buffer.set_text("左右")
        buffer.place_cursor(buffer.get_iter_at_offset(1))
        window.present()
        GLib.timeout_add(250, focus_reply)
    elif request["op"] == "get":
        buffer = editor.get_buffer()
        reply({"text": buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True)})
    elif request["op"] == "quit":
        Gtk.main_quit()
    return True

GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, command)
reply({"ready": True})
Gtk.main()
