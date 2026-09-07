import type { ReactNode } from "react";
import { Center } from "@chakra-ui/react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Center minHeight="100dvh" bg="bg.canvas" px="4" py="10">
      {children}
    </Center>
  );
}
