import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '../../../lib/apiBaseUrl';

function normalizePath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
}

export async function proxyToBackend(request: NextRequest, targetPath: string): Promise<NextResponse> {
    const sourceUrl = new URL(request.url);
    const backendUrl = `${API_BASE_URL}${normalizePath(targetPath)}${sourceUrl.search}`;

    const headers = new Headers();
    const contentType = request.headers.get('content-type');
    const authorization = request.headers.get('authorization');
    const xRequestedWith = request.headers.get('x-requested-with');

    if (contentType) headers.set('content-type', contentType);
    if (authorization) headers.set('authorization', authorization);
    if (xRequestedWith) headers.set('x-requested-with', xRequestedWith);

    const init: RequestInit = {
        method: request.method,
        headers,
        cache: 'no-store',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = await request.text();
    }

    const response = await fetch(backendUrl, init);
    const bodyText = await response.text();

    return new NextResponse(bodyText, {
        status: response.status,
        headers: {
            'content-type': response.headers.get('content-type') || 'application/json',
            'cache-control': 'no-store',
        },
    });
}
