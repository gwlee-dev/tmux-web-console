import * as React from 'react';

import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

/**
 * ResponsiveDialog — Dialog on desktop, Drawer on mobile.
 * Drawer lifts above the iOS keyboard via vaul; Dialog keeps the
 * familiar centered modal on pointer devices.
 */

type ResponsiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

function ResponsiveDialog({ open, onOpenChange, children }: ResponsiveDialogProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {children}
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

type ResponsiveDialogContentProps = React.ComponentProps<typeof DialogContent>;

function ResponsiveDialogContent({ className, children, ...props }: ResponsiveDialogContentProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerContent
        className={cn('px-4 pb-[max(env(safe-area-inset-bottom),1rem)]', className)}
      >
        {children}
      </DrawerContent>
    );
  }
  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  );
}

function ResponsiveDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerHeader className={cn('px-0 text-left', className)} {...props} />;
  }
  return <DialogHeader className={className} {...props} />;
}

function ResponsiveDialogTitle({ className, ...props }: React.ComponentProps<'div'>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerTitle className={className} {...props} />;
  }
  return <DialogTitle className={className} {...props} />;
}

function ResponsiveDialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerDescription className={className} {...props} />;
  }
  return <DialogDescription className={className} {...props} />;
}

function ResponsiveDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerFooter className={cn('px-0', className)} {...props} />;
  }
  return <DialogFooter className={className} {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
};
