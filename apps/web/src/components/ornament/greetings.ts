/**
 * The lines that appear under the wordmark on the title screen.
 *
 * Kept in their own module so they can be checked without rendering anything:
 * a line that runs long pushes the sign-in form down the screen, and a joke
 * that costs the form its position is not worth telling.
 */
export const GREETINGS = [
  "rm -rf doubt",
  "it works on my machine",
  "compiling confidence...",
  "segmentation fault: skill not found",
  "have you tried turning it off and on again",
  "sudo make me a coder",
  "99 little bugs in the code",
  "there is no cloud, just the lab PC",
  "git commit -m 'final final v2'",
  "the cake is a lie, the deadline is not",
  "may the source be with you",
  "Ctrl+S is a lifestyle",
  "O(1) coffee, O(n) bugs",
  "hello world, again",
  "stack overflow is a place, not a plan",
  "press start to allocate memory",
] as const;
