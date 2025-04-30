import jwt, { SignOptions } from 'jsonwebtoken';

// Validamos que la variable exista al cargar el módulo
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('La variable de entorno JWT_SECRET no está definida.');
}

// Interfaz para el payload del token (puedes ajustarla a tus necesidades)
export interface JwtUserPayload {
  id: number;
  username: string;
  role: 'admin' | 'office';
}

// Función para generar el token
export const generateToken = (
  payload: JwtUserPayload,
  options: SignOptions = { expiresIn: '1d' }
): string => {
  return jwt.sign(payload, JWT_SECRET, options);
};

// Función para verificar el token
export const verifyToken = (token: string): JwtUserPayload => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded as JwtUserPayload;
  } catch {
    throw new Error('Token inválido o expirado');
  }
};