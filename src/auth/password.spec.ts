import { hashPassword, verifyPassword } from './password';

describe('Almacenamiento de contraseñas', () => {
  it('usa salts distintos y verifica la contraseña sin guardar texto plano', async () => {
    const password = 'Una contraseña académica larga';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toEqual(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword('Una contraseña diferente', first)).toBe(false);
  });

  it('rechaza un hash con formato inválido', async () => {
    expect(await verifyPassword('Contraseña de prueba', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('Contraseña de prueba', 'scrypt:salt:00')).toBe(false);
  });
});
