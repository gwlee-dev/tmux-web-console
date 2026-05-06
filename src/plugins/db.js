import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

async function dbPlugin(app) {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db'
  const adapter = new PrismaLibSql({ url })
  const prisma = new PrismaClient({ adapter })
  await prisma.$connect()
  app.decorate('db', prisma)
  app.addHook('onClose', async () => prisma.$disconnect())
}

export default fp(dbPlugin)
