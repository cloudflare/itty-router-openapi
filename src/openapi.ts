import { getReDocUI, getSwaggerUI } from './ui'
import { RouterOptions } from './types'
import {
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
  OpenApiGeneratorV31,
  RouteConfig,
} from '@asteasolutions/zod-to-openapi'
import { OpenAPIRegistryMerger } from './zod/registry'
import { z } from 'zod'
import yaml from 'js-yaml'

export type OpenAPIRouterType<M> = {
  original: M
  options: RouterOptions
  registry: OpenAPIRegistryMerger
}

export class OpenAPIHandler {
  router: any
  options: RouterOptions
  registry: OpenAPIRegistryMerger

  allowedMethods = ['get', 'head', 'post', 'put', 'delete', 'patch']

  constructor(router: any, options?: RouterOptions) {
    this.router = router
    this.options = options || {}
    this.registry = new OpenAPIRegistryMerger()

    this.createDocsRoutes()
  }

  createDocsRoutes() {
    if (this.options?.docs_url !== null && this.options?.openapi_url !== null) {
      this.router.get(this.options?.docs_url || '/docs', () => {
        return new Response(
          getSwaggerUI(
            (this.options?.base || '') +
              (this.options?.openapi_url || '/openapi.json')
          ),
          {
            headers: {
              'content-type': 'text/html; charset=UTF-8',
            },
            status: 200,
          }
        )
      })
    }

    if (
      this.options?.redoc_url !== null &&
      this.options?.openapi_url !== null
    ) {
      this.router.get(this.options?.redoc_url || '/redocs', () => {
        return new Response(
          getReDocUI(
            (this.options?.base || '') +
              (this.options?.openapi_url || '/openapi.json')
          ),
          {
            headers: {
              'content-type': 'text/html; charset=UTF-8',
            },
            status: 200,
          }
        )
      })
    }

    if (this.options?.openapi_url !== null) {
      this.router.get(this.options?.openapi_url || '/openapi.json', () => {
        return new Response(JSON.stringify(this.getGeneratedSchema()), {
          headers: {
            'content-type': 'application/json;charset=UTF-8',
          },
          status: 200,
        })
      })

      this.router.get(
        (this.options?.openapi_url || '/openapi.json').replace(
          '.json',
          '.yaml'
        ),
        () => {
          return new Response(yaml.dump(this.getGeneratedSchema()), {
            headers: {
              'content-type': 'text/yaml;charset=UTF-8',
            },
            status: 200,
          })
        }
      )
    }
  }

  getGeneratedSchema() {
    let openapiGenerator: any = OpenApiGeneratorV31
    if (this.options?.openapiVersion === '3')
      openapiGenerator = OpenApiGeneratorV3

    const generator = new openapiGenerator(this.registry.definitions)

    const asd = generator.generateDocument({
      openapi: this.options?.openapiVersion === '3' ? '3.0.3' : '3.1.0',
      info: {
        version: this.options?.schema?.info?.version || '1.0.0',
        title: this.options?.schema?.info?.title || 'OpenAPI',
        ...this.options?.schema?.info,
      },
      ...this.options?.schema,
    })

    return asd
  }

  registerNestedRouter(params: {
    method: string
    path: string
    nestedRouter: any
  }) {
    this.registry.merge(params.nestedRouter.registry)

    return [params.nestedRouter.fetch]
  }

  parseRoute(path: string): string {
    return ((this.options.base || '') + path)
      .replaceAll(/\/+(\/|$)/g, '$1') // strip double & trailing splash
      .replaceAll(/:(\w+)/g, '{$1}') // convert parameters into openapi compliant
  }

  registerRoute(params: { method: string; path: string; handlers: any[] }) {
    const parsedRoute = this.parseRoute(params.path)

    // @ts-ignore
    let schema: RouteConfig = undefined
    // @ts-ignore
    let operationId: string = undefined

    for (const handler of params.handlers) {
      if (handler.name) {
        operationId = `${params.method}_${handler.name}`
      }

      if (handler.isRoute === true) {
        schema = new handler({}).getSchemaZod()
        break
      }
    }

    if (operationId === undefined) {
      operationId = `${params.method}_${parsedRoute.replaceAll('/', '_')}`
    }

    if (schema === undefined) {
      // No schema for this route, try to guest the parameters

      // @ts-ignore
      schema = {
        operationId: operationId,
        responses: {
          200: {
            description: 'Successful response.',
          },
        },
      }

      const parsedParams = ((this.options.base || '') + params.path).match(
        /:(\w+)/g
      )
      if (parsedParams) {
        schema.request = {
          // TODO: make sure this works
          params: z.object(
            parsedParams.reduce(
              // matched parameters start with ':' so replace the first occurrence with nothing
              (obj, item) =>
                Object.assign(obj, {
                  [item.replace(':', '')]: z.string(),
                }),
              {}
            )
          ),
        }
      }
    } else {
      // Schema was provided in the endpoint
      if (!schema.operationId) {
        if (
          this.options?.generateOperationIds === false &&
          !schema.operationId
        ) {
          throw new Error(`Route ${params.path} don't have operationId set!`)
        }

        schema.operationId = operationId
      }
    }

    this.registry.registerPath({
      ...schema,
      // @ts-ignore
      method: params.method,
      path: parsedRoute,
    })

    return params.handlers.map((handler: any) => {
      if (handler.isRoute) {
        return (...params: any[]) =>
          new handler({
            router: this,
            // raiseUnknownParameters: openapiConfig.raiseUnknownParameters,  TODO
          }).execute(...params)
      }

      return handler
    })
  }

  handleCommonProxy(target: any, prop: string, ...args: any[]) {
    // This is a hack to allow older versions of wrangler to use this library
    // https://github.com/cloudflare/workers-sdk/issues/5420
    if (prop === 'middleware') {
      return []
    }

    if (prop === 'original') {
      return this.router
    }
    if (prop === 'schema') {
      return this.getGeneratedSchema()
    }
    if (prop === 'registry') {
      return this.registry
    }

    return undefined
  }

  getRequest(args: any[]) {
    throw new Error('getRequest not implemented')
  }

  getUrlParams(args: any[]): Record<string, any> {
    throw new Error('getUrlParams not implemented')
  }
}
