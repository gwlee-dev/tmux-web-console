import * as React from "react"
import { Clock, LayoutGrid, Settings, TerminalIcon } from "lucide-react"

import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

const navItems = [
  { id: "recent" as const, title: "최근 세션", icon: Clock },
  { id: "sessions" as const, title: "세션 목록", icon: LayoutGrid },
]

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  username: string
  displayName?: string
  avatarUrl?: string
  role: "user" | "admin"
  activeNav: "sessions" | "recent"
  searchQuery: string
  onNavChange: (nav: "sessions" | "recent") => void
  onSearchChange: (query: string) => void
  onSettings: () => void
  onAccount: () => void
  onLogout: () => void
  children: React.ReactNode
}

export function AppSidebar({
  username,
  displayName,
  avatarUrl,
  role,
  activeNav,
  searchQuery,
  onNavChange,
  onSearchChange,
  onSettings,
  onAccount,
  onLogout,
  children,
  ...props
}: AppSidebarProps) {
  const { setOpen } = useSidebar()

  const activeTitle = navItems.find((item) => item.id === activeNav)?.title ?? "세션 목록"

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      {/* First sidebar: icon-only nav */}
      <Sidebar
        collapsible="none"
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
      >
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
                <a href="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <TerminalIcon className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">tmux 웹 콘솔</span>
                  </div>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      tooltip={{ children: item.title, hidden: false }}
                      onClick={() => {
                        onNavChange(item.id)
                        setOpen(true)
                      }}
                      isActive={activeNav === item.id}
                      className="px-2.5 md:px-2"
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {role === "admin" && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={{ children: "설정", hidden: false }}
                      onClick={onSettings}
                      className="px-2.5 md:px-2"
                    >
                      <Settings />
                      <span>설정</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser
            user={{
              name: displayName ?? username,
              email: username,
              avatar: avatarUrl ?? "",
            }}
            onAccount={onAccount}
            onLogout={onLogout}
          />
        </SidebarFooter>
      </Sidebar>

      {/* Second sidebar: content panel */}
      <Sidebar collapsible="none" className="hidden flex-1 md:flex">
        <SidebarHeader className="gap-3.5 border-b p-4">
          <div className="flex w-full items-center justify-between">
            <div className="text-base font-medium text-foreground">
              {activeTitle}
            </div>
          </div>
          <SidebarInput
            placeholder="세션 검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="px-0">
            <SidebarGroupContent>{children}</SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}
