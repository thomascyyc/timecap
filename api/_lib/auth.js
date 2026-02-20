import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export function parseUser(req) {
  const token = req.cookies?.token;
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { uid: payload.uid, email: payload.email };
  } catch {
    return null;
  }
}

export function signToken(uid, email) {
  return jwt.sign({ uid, email }, JWT_SECRET, { expiresIn: '30d' });
}

export function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; Secure`);
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure');
}
