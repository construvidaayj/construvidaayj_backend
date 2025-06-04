import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

export async function GET() {
  try {
    const password: string = 'wiliam021289';

    // Genera el hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10); // 10 es el salt rounds

    // Devuelve el hash
    return NextResponse.json({ hashedPassword }, { status: 200 });
  } catch (error: any) {
    console.error('Error hashing password:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
