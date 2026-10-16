"""Package the existing Windows build and source, then verify both archives."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
output = root / 'outputs'
output.mkdir(exist_ok=True)
build = root / 'release' / 'win-unpacked'
if not (build / 'Nocturne Notes.exe').is_file():
    raise SystemExit('Build the Windows directory before creating archives.')
excluded = {'.git', 'node_modules', 'release', 'dist', 'test-results', '.cache', 'outputs'}
archives = [
    (output / f'Nocturne-Notes-{version}-Windows-x64.zip', build, 'Nocturne Notes', set()),
    (output / f'Nocturne-Notes-{version}-Source.zip', root, 'DrawingApp', excluded),
]
checksums = []
for target, source, prefix, skip in archives:
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, strict_timestamps=False) as archive:
        for path in sorted(source.rglob('*')):
            relative = path.relative_to(source)
            if path.is_file() and not any(part in skip for part in relative.parts):
                archive.write(path, str(Path(prefix) / relative))
    with zipfile.ZipFile(target) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f'Archive integrity failure: {bad}')
    with target.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    checksums.append(f'{digest}  {target.name}')
    print(f'Validated {target.name}: {target.stat().st_size:,} bytes', flush=True)
(output / 'checksums.txt').write_text('\n'.join(checksums) + '\n')
