import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// DESIGN.md §8 Buttons. At most one filled (primary) button per view; danger is outlined
// except as the confirm button of a dialog (`danger-solid`).
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-[7px] rounded-control font-medium whitespace-nowrap select-none transition-[filter,transform,border-color,background-color,color] duration-150 active:scale-[.97] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand text-on-brand hover:brightness-[1.08]",
        secondary: "border-line bg-surface text-fg hover:border-line-strong border",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        danger: "border-sec bg-surface text-sec border",
        "danger-solid": "bg-sec text-surface hover:brightness-[1.08]",
        link: "text-brand h-auto! px-0! underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-[30px] rounded-[8px] px-[11px] text-[12.5px]",
        md: "h-9 px-3.5 text-[13.5px]",
        lg: "h-11 px-[18px] text-[14.5px]",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
