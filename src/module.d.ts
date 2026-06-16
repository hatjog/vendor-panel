declare module "virtual:medusa/forms" {
  import type { FormModule } from "./extensions"
  const formModule: FormModule
  export default formModule
}

declare module "virtual:medusa/links" {
  import type { LinkModule } from "./extensions"
  const linkModule: LinkModule
  export default linkModule
}

declare module "virtual:medusa/displays" {
  import type { DisplayModule } from "./extensions"
  const displayModule: DisplayModule
  export default displayModule
}

declare module "virtual:medusa/routes" {
  import type { RouteModule } from "./extensions"
  const routeModule: RouteModule
  export default routeModule
}

declare module "virtual:medusa/menu-items" {
  import type { MenuItemModule } from "./extensions"
  const menuItemModule: MenuItemModule
  export default menuItemModule
}

declare module "virtual:medusa/widgets" {
  import type { WidgetModule } from "./extensions"
  const widgetModule: WidgetModule
  export default widgetModule
}

declare module "virtual:mercur/config" {
  const config: {
    backendUrl?: string
    storefrontUrl?: string
    base?: string
    i18n?: {
      defaultLanguage?: string
    }
  }
  export default config
}

declare module "virtual:mercur/routes" {
  export const customRoutes: unknown[]
}

declare module "virtual:mercur/components" {
  const components: unknown[]
  export default components
}

declare module "virtual:mercur/menu-items" {
  const menuItems: unknown[]
  export default menuItems
}

declare module "virtual:mercur/i18n" {
  const resources: Record<string, unknown>
  export default resources
}
