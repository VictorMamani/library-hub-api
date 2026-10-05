# Library Hub API

![Licencia: sin definir](https://img.shields.io/badge/licencia-sin%20definir-lightgrey)
[![npm: 10.9.3](https://img.shields.io/badge/npm-10.9.3-CB3837?logo=npm)](https://docs.npmjs.com/cli/v10/)
[![Build de GitLab CI/CD: sin pipeline](https://img.shields.io/badge/build-sin%20pipeline-lightgrey?logo=gitlab)](https://gitlab.com/jala-university1/cohort-3/ES.CO.CSWB-366.GA.T2.26.M2/SC/victor-mamani/capstone/library-hub-api/-/pipelines?ref=main)

API modular con NestJS, TypeScript y PostgreSQL para autenticación, catálogo y préstamos de una biblioteca universitaria.

## Entorno completo

Requiere Docker con Compose y los repositorios `library-hub-api` y `library-hub-frontend` en carpetas hermanas. Node.js 22 desde 22.13, o Node.js 24 o superior, permite ejecutar los scripts localmente.

```bash
npm ci
npm run setup:dev
docker compose up -d --build
```

`setup:dev` crea el `.env` local desde el ejemplo y reemplaza el secreto de ejemplo por uno aleatorio. No sobrescribe un secreto ya configurado. El archivo queda fuera del control de versiones.

- Aplicación: `http://localhost:5180`
- Salud de la API y PostgreSQL: `http://localhost:3001/api/health`
- PostgreSQL local: puerto `54329`

Para ver el estado o detener los servicios conservando los datos:

```bash
docker compose ps
docker compose logs api
docker compose stop
```

## Desarrollo local con PostgreSQL en Docker

```bash
docker compose up -d database
npm run dev
```

Ejecutar el frontend por separado. Las migraciones SQL se aplican al iniciar la API, dentro de una transacción con bloqueo de migraciones y verificación de checksum. Las migraciones ya aplicadas no se modifican.

## Autenticación

Registro y login entregan un access token JWT de 15 minutos y una cookie de renovación `HttpOnly`, `SameSite=Strict` y `Secure` en producción. La sesión del servidor dura como máximo siete días. La renovación rota el token y el logout revoca la sesión; los endpoints protegidos verifican también que la sesión siga activa.

Las solicitudes POST a `/api/auth/*` requieren `Origin` igual a `APP_ORIGIN` y `X-Library-Client: web`. Los endpoints protegidos usan `Authorization: Bearer <access-token>`. Las contraseñas requieren entre 12 y 128 caracteres y se almacenan con scrypt y salt aleatorio.

## Préstamos

La versión inicial asigna un ejemplar académico por libro. PostgreSQL impide préstamos activos simultáneos del mismo ejemplar. `LOAN_DAYS` configura el vencimiento, con 21 días como valor inicial. Cada usuario puede consultar y devolver sus propios préstamos; la devolución conserva el historial.

## Comprobaciones

```bash
npm run build
npm run lint
npm run format:check
npm test
```

## Formato y calidad del código

Prettier mantiene el formato y ESLint revisa JavaScript/TypeScript. La configuración compartida usa dos espacios, comillas simples, punto y coma y un ancho de referencia de 100 caracteres.

```bash
npm run format
npm run lint:fix
npm run check
```

`format` aplica el formato; `format:check` lo comprueba sin editar. `check` ejecuta formato, lint, compilación y pruebas unitarias. Las pruebas de integración se ejecutan por separado porque requieren PostgreSQL. Las migraciones aplicadas quedan excluidas del formateador para conservar sus checksums.

VS Code dispone de recomendaciones de extensiones y formato al guardar; instalar Prettier y ESLint desde esas recomendaciones. `.editorconfig` define indentación y finales de línea para otros editores compatibles.

El `.gitignore` excluye dependencias, compilaciones, cobertura, archivos locales de entorno y temporales. `.env.example`, los lockfiles y las configuraciones compartidas del editor se incluyen en el control de versiones.

Las pruebas de integración requieren una base dedicada, `library_hub_test`, en el PostgreSQL de desarrollo:

```bash
docker compose exec -T database psql -U library_hub -d postgres -c 'CREATE DATABASE library_hub_test;'
npm run test:integration
```

Si la base ya existe, omitir su creación. Puede configurarse `TEST_DATABASE_URL`; las pruebas rechazan otra base y limpian exclusivamente las tablas de `library_hub_test`.

## Producción

```bash
docker build --target production -t library-hub-api .
```

Configurar `NODE_ENV=production`, `DATABASE_URL`, un `JWT_SECRET` aleatorio y `APP_ORIGIN` con HTTPS. Cuando el proveedor requiera TLS para PostgreSQL, usar `DATABASE_SSL=true` y los certificados de confianza necesarios. La aplicación falla al iniciar si la configuración esencial no es válida. Compose está destinado al desarrollo local.
