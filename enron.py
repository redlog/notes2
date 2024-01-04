import time

import dateutil.parser
import email
import os
import sys
import re

from config import Config
from index import Index


def process_mail_file(file_path):
    # print(file_path)
    if file_path.endswith(".txt"):
        with open(file_path, 'r') as fp:
            msg = email.message_from_file(fp)
        d = dict(msg._headers)
        from_ = [_ for _ in re.split("[ ,\r\t\n]", d.get("From") or '') if _.endswith('@enron.com')]
        to_ = [_ for _ in re.split("[ ,\r\t\n]", d.get("To") or '') if _.endswith('@enron.com')]
        cc_ = [_ for _ in re.split("[ ,\r\t\n]", d.get("Cc") or '') if _.endswith('@enron.com')]
        bcc_ = [_ for _ in re.split("[ ,\r\t\n]", d.get("Bcc") or '') if _.endswith('@enron.com')]
        dt = int(dateutil.parser.parse(d.get("Date")).timestamp())  # Wed, 13 Dec 2000 08:39:00 -0800 (PST)
        subject = d.get("Subject", "(no subject)")
        # print("From:", from_)
        # print("To: ", to_)
        # print("Cc: ", cc_)
        # print("Bcc: ", bcc_)
        # print("Date: ", dt)
        # print("Subject: ", subject)
        # print("")
        recipients = set(to_ + cc_ + bcc_)
        if len(recipients) == 0:
            return None, None, None, None
        if len(from_) == 0:
            return None, None, None, None
        return ['@' + _[:-10] for _ in recipients.union(set(from_))], dt, subject, msg.get_payload()
    return None, None, None, None


if __name__ == '__main__':

    cfg = Config()
    cfg.load()
    cfg.set_active_project("enron")
    idx = Index()
    idx.load(cfg)

    enron_dir = "C:\\Users\\scott\\Downloads\\enron-maildir\\"

    i = 0
    for root, dirs, files in os.walk(enron_dir, topdown=False):
        for name in files:
            people, timestamp, title, body = process_mail_file(os.path.join(root, name))
            if people is not None:
                idx.new_file(people_list=people, title=title, body=body, override_timestamp=timestamp)
            i += 1
            if i % 100 == 0:
                print(time.time(), "\t", i)
            if i > 5 * 1000:
                sys.exit()
