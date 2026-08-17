import { ConnectionEnvironment } from '@/lib/adapters/types';

interface EnvironmentStyle {
  label: string;
  /** Badge/---indicator classes. */
  badgeClass: string;
  dotClass: string;
  /** True for environments that warrant a persistent banner. */
  prominent: boolean;
}

const STYLES: Record<ConnectionEnvironment, EnvironmentStyle> = {
  development: {
    label: 'Development',
    badgeClass:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    dotClass: 'bg-emerald-500',
    prominent: false,
  },
  staging: {
    label: 'Staging',
    badgeClass:
      'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    dotClass: 'bg-amber-500',
    prominent: false,
  },
  production: {
    label: 'Production',
    badgeClass:
      'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40',
    dotClass: 'bg-red-500',
    prominent: true,
  },
};

/** Environment for a connection, defaulting to development when unset. */
export function environmentOf(
  environment?: ConnectionEnvironment
): ConnectionEnvironment {
  return environment ?? 'development';
}

export function environmentStyle(
  environment?: ConnectionEnvironment
): EnvironmentStyle {
  return STYLES[environmentOf(environment)];
}

export function isProduction(environment?: ConnectionEnvironment): boolean {
  return environmentOf(environment) === 'production';
}

export const ENVIRONMENTS: ConnectionEnvironment[] = [
  'development',
  'staging',
  'production',
];
