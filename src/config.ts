export function validateEnvironment(input: Record<string, unknown>) {
  const production = input.NODE_ENV === 'production';
  const databaseUrl = String(input.DATABASE_URL ?? '');
  const secret = String(input.JWT_SECRET ?? '');
  const origin = String(input.APP_ORIGIN ?? 'http://localhost:5180');
  const port = Number(input.PORT ?? 3001);
  const loanDays = Number(input.LOAN_DAYS ?? 21);

  if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL.');
  if (secret.length < 32 || secret.startsWith('replace-'))
    throw new Error('JWT_SECRET debe ser un secreto aleatorio de al menos 32 caracteres.');
  const parsedOrigin = new URL(origin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
    throw new Error('APP_ORIGIN debe contener solo el origen, sin rutas ni barra final.');
  }
  if (production && parsedOrigin.protocol !== 'https:')
    throw new Error('APP_ORIGIN debe usar HTTPS en producción.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT no es válido.');
  if (!Number.isInteger(loanDays) || loanDays < 1 || loanDays > 365)
    throw new Error('LOAN_DAYS debe estar entre 1 y 365.');

  return {
    ...input,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: secret,
    APP_ORIGIN: origin,
    PORT: port,
    LOAN_DAYS: loanDays,
  };
}
