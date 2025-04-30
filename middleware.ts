// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();  // Crear la respuesta base

  // Establecer las cabeceras CORS
  response.headers.set('Access-Control-Allow-Origin', '*'); // Permitir cualquier origen
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Allow-Credentials', 'true');

  // Si es una solicitud OPTIONS (preflight CORS)
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    });
  }

  // Si no es una solicitud OPTIONS, retornar la respuesta normalmente
  return response;
}

export const config = {
  matcher: '/api/:path*', // Aplica este middleware a todas las rutas dentro de /api/
};
