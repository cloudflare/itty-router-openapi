import { type RouterOptions } from '../types'
import { OpenAPIHandler, type OpenAPIRouterType } from '../openapi'

export class HonoOpenAPIHandler extends OpenAPIHandler {
  getRequest(args: any[]) {
    return args[0].req.raw
  }

  getUrlParams(args: any[]): Record<string, any> {
    return args[0].req.param()
  }
}

export function fromHono<M>(
  router: M,
  options?: RouterOptions
): M & OpenAPIRouterType<M> & any {
  const openapiRouter = new HonoOpenAPIHandler(router, options)

  return new Proxy(router, {
    get: (target: any, prop: string, ...args: any[]) => {
      const _result = openapiRouter.handleCommonProxy(target, prop, ...args)
      if (_result !== undefined) {
        return _result
      }

      return (route: string, ...handlers: any[]) => {
        if (prop !== 'fetch') {
          if (handlers.length === 1 && handlers[0].isChanfana === true) {
            handlers = openapiRouter.registerNestedRouter({
              method: prop,
              path: route,
              nestedRouter: handlers[0],
            })
          } else if (openapiRouter.allowedMethods.includes(prop)) {
            handlers = openapiRouter.registerRoute({
              method: prop,
              path: route,
              handlers: handlers,
            })
          }
        }

        return Reflect.get(target, prop, ...args)(route, ...handlers)
      }
    },
  })
}
