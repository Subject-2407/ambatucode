import { Box, HStack, Text } from "@chakra-ui/react";

/**
 * The wordmark. The tile runs the primary seed into the secondary one — the
 * only place the two brand colours meet directly.
 */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <HStack gap="2.5">
      <Box
        aria-hidden
        width="8"
        height="8"
        rounded="l2"
        bgGradient="to-br"
        gradientFrom="brand.900"
        gradientTo="plum.950"
        color="white"
        fontWeight="bold"
        fontSize="sm"
        display="grid"
        placeItems="center"
        flexShrink="0"
      >
        A
      </Box>
      {compact ? null : (
        <Text fontWeight="semibold" fontSize="md" letterSpacing="tight" color="fg.default">
          Ambatucode
        </Text>
      )}
    </HStack>
  );
}
