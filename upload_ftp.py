#!/usr/bin/env python3
import ftplib
import os
import ssl

HOST = "citycar36.ru"
LOGIN = "u3380578"
PASSWORD = "Red19820405)"
REMOTE_BASE = "/www/kairos.opentgp.ru/gm-crm"
LOCAL_BASE = "/Users/annagranenova/crm/apps/gm-crm/dist"
SKIP_FILES = {"pricelist.json"}

def ensure_remote_dir(ftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    path = ""
    for part in parts:
        path += "/" + part
        try:
            ftp.cwd(path)
        except ftplib.error_perm:
            try:
                ftp.mkd(path)
                print(f"  Created dir: {path}")
            except ftplib.error_perm as e:
                print(f"  Could not create dir {path}: {e}")

def upload_all():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    ftp = ftplib.FTP_TLS(context=ctx)
    ftp.connect(HOST, 21)
    ftp.login(LOGIN, PASSWORD)
    ftp.prot_p()
    print(f"Connected to {HOST}")

    uploaded = 0
    skipped = 0

    for root, dirs, files in os.walk(LOCAL_BASE):
        for filename in files:
            if filename in SKIP_FILES:
                print(f"  SKIP: {filename}")
                skipped += 1
                continue

            local_path = os.path.join(root, filename)
            rel_path = os.path.relpath(local_path, LOCAL_BASE)
            remote_path = REMOTE_BASE + "/" + rel_path.replace(os.sep, "/")
            remote_dir = os.path.dirname(remote_path)

            ensure_remote_dir(ftp, remote_dir)
            ftp.cwd(remote_dir)

            with open(local_path, "rb") as f:
                ftp.storbinary(f"STOR {filename}", f)
            print(f"  Uploaded: {rel_path}")
            uploaded += 1

    ftp.quit()
    print(f"\nDone. Uploaded: {uploaded} files, Skipped: {skipped} files.")
    return uploaded

if __name__ == "__main__":
    upload_all()
