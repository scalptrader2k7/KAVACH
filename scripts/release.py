"""Deterministic, allowlist-only release builder and independent archive verifier.
Never copies runtime directories. No imports from backend.app/engine are needed.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STAMP = (2026, 10, 16, 0, 0, 0)
MANIFEST = 'RELEASE_MANIFEST.json'
FORBIDDEN_PARTS = {'data','node_modules','.venv','venv','.git','.ssh','.aws','.cache','.arena','__pycache__','.pytest_cache','uploads','credentials','video','cache','tmp','temp','.npm','.vite','.next','coverage'}
FORBIDDEN_SUFFIXES = ('.sqlite','.sqlite3','.db','.db-journal','.sqlite3-journal','.sqlite-journal','-wal','-shm','.pem','.key','.p12','.pfx','.pyc','.tmp','.log','.zip','.tar','.gz')

class ReleaseError(ValueError):
    pass

def safe_path(name: str) -> bool:
    p = PurePosixPath(name)
    return bool(name) and not p.is_absolute() and '\\' not in name and all(x not in ('','..','.') for x in name.split('/')) and not any(x.lower() in FORBIDDEN_PARTS or x.lower().startswith('.env') or x.lower() in {'sender-secrets.json','.netrc','.git-credentials','.npmrc','.pypirc','id_rsa','id_ed25519'} for x in p.parts) and not name.lower().endswith(FORBIDDEN_SUFFIXES)

def load_allowlist(root: Path) -> list[str]:
    data = json.loads((root/'release-files.json').read_text())
    files = data['files']
    if not isinstance(files,list) or len(files)!=len(set(files)) or not all(isinstance(n,str) and safe_path(n) and n!=MANIFEST for n in files):
        raise ReleaseError('Invalid or forbidden release allowlist path.')
    return sorted(files)

def secret_patterns(secret_files: list[Path]) -> list[bytes]:
    patterns=set()
    for path in secret_files:
        if not path.exists(): continue
        try: data=json.loads(path.read_text())
        except (ValueError,OSError): raise ReleaseError('Unable to inspect a configured secret source; refusing release.') from None
        def collect(v):
            if isinstance(v,dict):
                for x in v.values(): collect(x)
            elif isinstance(v,list):
                for x in v: collect(x)
            elif isinstance(v,str) and len(v)>=32:
                b=v.encode();patterns.update([b,base64.b64encode(b)])
                if re.fullmatch(r'[0-9a-fA-F]{64}',v):
                    raw=bytes.fromhex(v);patterns.update([raw,v.lower().encode(),v.upper().encode(),base64.b64encode(raw)])
        collect(data)
    return sorted(patterns)

def scan_bytes(name: str, content: bytes, patterns: list[bytes]) -> None:
    if any(p in content for p in patterns):
        raise ReleaseError(f'Known runtime signing material detected in {name}; no secret value is printed.')
    if re.search(rb'-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----',content):
        raise ReleaseError(f'Private-key marker detected in {name}.')

def default_secret_files(root: Path) -> list[Path]:
    files=[root/'data/sender-secrets.json']
    if os.environ.get('KAVACH_DATA_DIR'): files.append(Path(os.environ['KAVACH_DATA_DIR'])/'sender-secrets.json')
    return files

def validate_archive(archive: Path, root: Path=ROOT, secret_files: list[Path]|None=None) -> dict:
    allowed=load_allowlist(root)
    patterns=secret_patterns(default_secret_files(root)+(secret_files or []))
    with zipfile.ZipFile(archive) as z:
        names=z.namelist()
        if sum(entry.file_size for entry in z.infolist())>64*1024*1024:
            raise ReleaseError('Uncompressed archive exceeds the bounded release size.')
        expected={'kavach/'+n for n in allowed+[MANIFEST]}
        if len(names)!=len(set(names)) or set(names)!=expected:
            raise ReleaseError('Archive member set does not match the exact source allowlist.')
        manifest=json.loads(z.read('kavach/'+MANIFEST))
        if set(manifest.get('files',{}))!=set(allowed): raise ReleaseError('Manifest file set mismatch.')
        for entry in z.infolist():
            name=entry.filename
            relative=name.removeprefix('kavach/')
            if not safe_path(relative) or stat.S_ISLNK(entry.external_attr>>16) or entry.file_size>32*1024*1024:
                raise ReleaseError('Forbidden path, symlink, or oversized archive member.')
            if entry.date_time!=STAMP: raise ReleaseError('Non-deterministic archive timestamp.')
            content=z.read(entry)
            scan_bytes(name,content,patterns)
            if relative!=MANIFEST:
                observed={'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}
                if observed!=manifest['files'][relative]: raise ReleaseError('Archive content hash mismatch.')
        if z.testzip() is not None: raise ReleaseError('Archive CRC failure.')
    return {'status':'PASS','members':len(names),'known_secret_sources_checked':len(set(str(p) for p in default_secret_files(root)+(secret_files or []) if p.exists())),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'note':'Exact allowlist, forbidden names, symlinks, hashes, private-key markers, and known secret byte/hex/base64 values checked. Not a universal secret detector.'}

def build_release(root: Path, output: Path, secret_files: list[Path]|None=None) -> dict:
    allowed=load_allowlist(root)
    patterns=secret_patterns(default_secret_files(root)+(secret_files or []))
    content={}
    for name in allowed:
        path=root/name
        if any(parent.is_symlink() for parent in [path,*path.parents] if parent!=root.parent) or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            raise ReleaseError(f'Missing or unsafe allowlisted source: {name}')
        content[name]=path.read_bytes();scan_bytes(name,content[name],patterns)
    # Defense in depth: inspect actual built browser assets too, even when not distributed.
    if (root/'dist').exists():
        for path in (root/'dist').rglob('*'):
            if path.is_symlink(): raise ReleaseError('Symlink in compiled frontend.')
            if path.is_file(): scan_bytes('compiled frontend asset',path.read_bytes(),patterns)
    manifest={'schema_version':1,'packaging_policy':'exact allowlist / no runtime material','files':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(content.items())}}
    content[MANIFEST]=(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode()
    output.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='kavach-release-',suffix='.zip',dir=output.parent);os.close(fd)
    temporary=Path(temp)
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for name,b in sorted(content.items()):
                info=zipfile.ZipInfo('kavach/'+name,STAMP);info.create_system=3
                info.external_attr=(stat.S_IFREG | (0o755 if name.endswith('.sh') else 0o644))<<16
                info.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(info,b,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        result=validate_archive(temporary,root,secret_files)
        os.replace(temporary,output)
        return result
    finally: temporary.unlink(missing_ok=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--output',type=Path,default=ROOT.parent/'Kavach-hardened-release.zip')
    parser.add_argument('--verify',type=Path)
    parser.add_argument('--secret-file',action='append',type=Path,default=[],help='Additional known compromised/archived secret source; values never printed.')
    args=parser.parse_args()
    try:
        result=validate_archive(args.verify,args.root,args.secret_file) if args.verify else build_release(args.root,args.output,args.secret_file)
    except (ReleaseError,OSError,ValueError,zipfile.BadZipFile) as e:
        parser.exit(1,f'Release refused: {e}\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__': main()
