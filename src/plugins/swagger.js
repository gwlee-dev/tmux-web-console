import fp from 'fastify-plugin';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

async function swaggerPlugin(fastify) {
  await fastify.register(fastifySwagger, {
    transform: ({ schema, url }) => {
      // Hide Vite client routes and internal paths from Swagger.
      const hiddenPaths = ['/interaction', '/-/data', '/@'];
      if (hiddenPaths.some((path) => url.startsWith(path))) {
        return { schema: { ...schema, hide: true }, url };
      }
      return { schema, url };
    },
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'tmux-web-console',
        description: 'tmux 세션을 브라우저에서 제어하는 API',
        version: '1.0.0',
      },
      servers: [
        {
          url: '/',
          description: 'Current server',
        },
      ],
      tags: [
        { name: 'Health', description: '헬스체크 API' },
        { name: 'Auth', description: '인증 API' },
        { name: 'Sessions', description: 'tmux 세션 관리 API' },
        { name: 'Windows', description: 'tmux 윈도우 관리 API' },
        { name: 'Panes', description: 'tmux 패널 관리 API' },
        { name: 'Commands', description: '명령 전송 API' },
        { name: 'Uploads', description: '파일 업로드 API' },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'tmux_web_console_session',
          },
        },
      },
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: false,
  });
}

export default fp(swaggerPlugin, {
  name: 'swagger',
});
