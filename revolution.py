import time

import dateutil.parser
import email
import os
import sys
import re

from config import Config
from index import Index

if __name__ == '__main__':

    cfg = Config()
    cfg.load()
    cfg.set_active_project("my_notes")
    idx = Index()
    idx.load(cfg)

    filename = "C:\\Users\\scott\\Dropbox\\code\\notes\\misc\\revolution\\chatgpt_output.txt"

    with open(filename, 'r') as fp:
        b = fp.read()

    lectures = re.split("# Lecture ", b)
    lectures = ["# Lecture " + s for s in lectures]
    lectures.pop(0)

    for i, lecture in enumerate(lectures):
        # print(lecture)
        # print("----------")
        lines = lecture.split('\n')
        title = lines.pop(0)
        title = title[2:]  # trim off "# "
        body = '\n'.join(lines)
        idx.new_file(tag_list=['#courses', '#us_history'], people_list=[], title=title, body=body)  # , override_timestamp=timestamp)
        time.sleep(2)
