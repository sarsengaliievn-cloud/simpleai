import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/', '/login', '/register', '/api/health'];
/** Meta стучится без куки — подпись проверяет сам обработчик вебхука. */
const PUBLIC_PREFIXES = ['/api/webhooks/'];

/**
 * Быстрая проверка: есть ли вообще кука сессии. Настоящая проверка
 * происходит в requireCompany() — middleware не ходит в базу, чтобы
 * не добавлять запрос к каждому переходу.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!request.cookies.get('wa_session')) {
    // API отвечает кодом, а не HTML-страницей входа: fetch на клиенте
    // иначе падает на разборе JSON с непонятной ошибкой.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Сессия истекла — войдите заново' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
