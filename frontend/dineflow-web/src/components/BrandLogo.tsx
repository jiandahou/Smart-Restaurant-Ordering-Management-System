import dineflowLogo from '../assets/dineflow-logo.svg'
import dineflowMark from '../assets/dineflow-mark.svg'
import { cn } from '../lib/utils'

type BrandLogoProps = {
  className?: string
  imageClassName?: string
  markOnly?: boolean
}

export function BrandLogo({ className, imageClassName, markOnly = false }: BrandLogoProps) {
  return (
    <span className={cn('brand-logo', markOnly && 'brand-logo-mark-only', className)} aria-label="DineFlow">
      <img
        src={markOnly ? dineflowMark : dineflowLogo}
        alt=""
        aria-hidden="true"
        className={cn('brand-logo-image', imageClassName)}
      />
    </span>
  )
}
