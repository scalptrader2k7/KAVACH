"""Run the real 29-case receiver suite without touching the presenter's runtime.
Usage: python -m scripts.run_scenarios --output reports/sprint/runtime-scenarios.json
"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from backend.engine import Engine

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path('reports/sprint/runtime-scenarios.json'))
    args=parser.parse_args()
    with TemporaryDirectory(prefix='kavach-verification-') as directory:
        receiver=Engine(directory)
        before=receiver.state()
        result=receiver.scenarios()
        result['presenter_runtime_untouched']=receiver.state()==before
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(f"{result['passed']}/{result['total']} real runtime scenarios passed; isolated active state unchanged: {result['presenter_runtime_untouched']}")
    if result['passed']!=result['total'] or not result['presenter_runtime_untouched']:
        raise SystemExit(1)

if __name__=='__main__':main()
