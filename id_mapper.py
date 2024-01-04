import os
import sys
import re
import json


idreg = re.compile("id=\"(.*?)\"")
ids = set()

for root, dirs, files in os.walk("templates", topdown=False):
    for name in files:
        with open(os.path.join("templates", name), 'r') as fp:
            for line in fp:
                res = idreg.findall(line)
                if res:
                    for g in res:
                        ids.add(g)

id_map = dict([(s, 'id' + str(i).zfill(4)) for (s, i) in zip(sorted(ids), range(len(ids)))])
j = json.dumps(id_map)
sys.stdout.write(j)

