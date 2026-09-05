"""Read-only assertions input for browser PDF tests (no renderer or PDF generation here)."""
import json
import sys
from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
pages = []
for page in reader.pages:
    links = []
    for reference in page.get('/Annots', []):
        annotation = reference.get_object()
        action = annotation.get('/A', {})
        if action.get('/URI'):
            links.append(str(action['/URI']))
    pages.append({
        'text': page.extract_text() or '',
        'width': float(page.mediabox.width),
        'height': float(page.mediabox.height),
        'images': len(page.images),
        'links': links,
    })
print(json.dumps(pages, ensure_ascii=True))
