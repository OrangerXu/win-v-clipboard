"""Runs inside a real GNOME Terminal without a shell or command execution."""
import json, os, select, signal, sys, termios, time, tty
from pathlib import Path
output = Path(sys.argv[1])
expected = int(sys.argv[2])
fd = sys.stdin.fileno()
original = termios.tcgetattr(fd)
data = bytearray()
signal.alarm(35)
try:
    tty.setraw(fd)
    os.write(sys.stdout.fileno(), b"\x1b[?2004h")
    output.with_suffix(".ready").write_text("ready")
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if select.select([fd], [], [], 0.1)[0]:
            data.extend(os.read(fd, 65536))
            plain = bytes(data).replace(b"\x1b[200~", b"").replace(b"\x1b[201~", b"")
            if len(plain) >= expected:
                break
    output.write_text(json.dumps({"hex": bytes(data).hex()}))
finally:
    os.write(sys.stdout.fileno(), b"\x1b[?2004l")
    termios.tcsetattr(fd, termios.TCSANOW, original)
