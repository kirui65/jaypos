import {
  AlertCircle,
  Banknote,
  Boxes,
  Check,
  Clock3,
  Footprints,
  Image,
  LayoutDashboard,
  LogOut,
  Menu,
  Minus,
  Package,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Shirt,
  ShoppingCart,
  Sparkles,
  SprayCan,
  Trash2,
  Upload,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import type { SVGProps } from "react";

const icons = {
  alert: AlertCircle,
  banknote: Banknote,
  boxes: Boxes,
  check: Check,
  clock: Clock3,
  feet: Footprints,
  image: Image,
  layout: LayoutDashboard,
  logout: LogOut,
  menu: Menu,
  minus: Minus,
  package: Package,
  plus: Plus,
  receipt: ReceiptText,
  rotate: RotateCcw,
  search: Search,
  shirt: Shirt,
  cart: ShoppingCart,
  sparkles: Sparkles,
  spray: SprayCan,
  trash: Trash2,
  upload: Upload,
  user: UserRound,
  users: Users,
  wifi: Wifi,
  "wifi-off": WifiOff,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({
  name,
  className = "",
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  const Component = icons[name];
  return (
    <Component
      className={`ej-icon ${className}`}
      size="var(--ej-icon-size)"
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}
