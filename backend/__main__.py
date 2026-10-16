"""Safe local launcher: python -m backend [--port 8000]."""
import argparse
import os
import sys
import uvicorn

WARNING = ('WARNING: external KAVACH access enabled. The fixture issuer can sign privileged '
           'synthetic commands; sessions and exported evidence are not access-controlled. '
           'Use only an isolated trusted demo network, never an untrusted public deployment.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',default=os.environ.get('KAVACH_HOST','127.0.0.1'))
    parser.add_argument('--port',type=int,default=int(os.environ.get('KAVACH_PORT','8000')))
    args=parser.parse_args()
    if args.host not in {'127.0.0.1','localhost','::1'}:
        if os.environ.get('KAVACH_ALLOW_EXTERNAL')!='1':
            parser.error('Non-loopback binding requires deliberate KAVACH_ALLOW_EXTERNAL=1. '+WARNING)
        print(WARNING,file=sys.stderr,flush=True)
    uvicorn.run('backend.app:app',host=args.host,port=args.port,log_level='info')

if __name__=='__main__': main()
