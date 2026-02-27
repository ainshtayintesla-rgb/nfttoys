import { NextRequest } from 'next/server';

import { proxyToBackend } from '../../_utils/proxy';

export async function DELETE(request: NextRequest) {
    return proxyToBackend(request, '/qr/delete');
}
