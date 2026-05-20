import {
  Wallet, PiggyBank, Home, Car, GraduationCap, Plane, Heart, Briefcase,
  BabyIcon, Building2, ShoppingBag, Gem, Sailboat, Trees, BookOpen,
  Activity, type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  'piggy-bank': PiggyBank,
  home: Home,
  car: Car,
  graduation: GraduationCap,
  plane: Plane,
  heart: Heart,
  briefcase: Briefcase,
  baby: BabyIcon,
  building: Building2,
  shopping: ShoppingBag,
  gem: Gem,
  sailboat: Sailboat,
  trees: Trees,
  book: BookOpen,
  activity: Activity,
};

export const ICON_NAMES = Object.keys(ICONS);

interface Props {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function BucketIcon({ name, size = 18, className = '', strokeWidth = 2 }: Props) {
  const Icon = ICONS[name] || Wallet;
  return <Icon size={size} className={className} strokeWidth={strokeWidth} />;
}
