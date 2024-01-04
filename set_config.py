import sys
from subprocess import Popen, PIPE
import datetime


body = ""
for line in sys.stdin:
    body += line

build_date = str(datetime.datetime.now())[:10]

proc = Popen(["git", "describe"], stdout=PIPE)
output, err = proc.communicate()
exit_code = proc.wait()

build_ver = output.strip()
build_ver = build_ver.decode()

body = body.replace("REPLACE_WITH_BUILD_DATE", build_date)
body = body.replace("REPLACE_WITH_BUILD_VERSION", build_ver)

sys.stdout.write(body)

