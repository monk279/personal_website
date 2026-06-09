import { hashPassword } from "../src/server/security";

const password = Bun.argv[2];

if (!password) {
  console.error("Usage: bun run admin:hash -- \"your-admin-password\"");
  process.exit(1);
}

console.log(await hashPassword(password));
