/**
 * Food icons for the order grid.
 *
 * Drawn here as inline SVG rather than shipped as image files: the app is
 * offline, so nothing may be downloaded; these cost a few KB in the bundle,
 * stay crisp at any size on a cheap low-res counter screen, and inherit
 * currentColor so they re-tint with the theme instead of needing a second set
 * for the dark palette.
 *
 * They exist for ONE reason: recognition speed. A cashier under pressure spots
 * a shape faster than they read a word, especially in a long list where every
 * item starts "Chicken…". They are deliberately small and quiet — the name and
 * the price stay the dominant things on the card, because those are what the
 * order actually depends on.
 */

type Props = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function IconBurger({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 8.5c0-2.8 3.8-4.5 8.5-4.5s8.5 1.7 8.5 4.5" />
      <path d="M3.5 11.5h17" />
      <path d="M4.5 14.5c-.6 0-1 .4-1 1 0 2 3.5 4 9.5 4s9.5-2 9.5-4c0-.6-.4-1-1-1Z" />
      <path d="M7 7.5h.01M11 6.6h.01M15 7.5h.01" />
    </svg>
  );
}

export function IconPizza({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M12 3.2 21 19.5c-2.6 1.5-5.7 2.3-9 2.3s-6.4-.8-9-2.3Z" />
      <path d="M5.6 12.2c4-2 8.8-2 12.8 0" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.4" cy="16" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPasta({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3 13.5h18a9 9 0 0 1-18 0Z" />
      <path d="M2 20.5h20" />
      <path d="M8 10.5c0-3 .8-5.5 1.8-6.8M12 10.5c0-3.4.5-6 1.2-7.3M16 10.5c-.2-2.6-.8-4.6-1.6-5.8" />
    </svg>
  );
}

export function IconFries({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M6 10.5h12l-1.2 9a1.5 1.5 0 0 1-1.5 1.3H8.7a1.5 1.5 0 0 1-1.5-1.3Z" />
      <path d="M6 13.5h12" />
      <path d="M8.5 10.5V5.8M11.5 10.5V3.4M14.5 10.5V5.2M17 10.5V7" />
    </svg>
  );
}

export function IconSandwich({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M2.8 9.2 12 4.4l9.2 4.8-9.2 4.6Z" />
      <path d="M2.8 13.4 12 18l9.2-4.6" />
      <path d="M4.6 16.2 12 20l7.4-3.8" />
    </svg>
  );
}

export function IconWrap({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M7.6 21.2 5 13.4C3.9 10 5.7 6.4 9.1 5.2s7 .5 8.2 3.9l2.6 7.8Z" />
      <path d="M9.4 9.6c2.2-.8 4.6-.5 6.4.8" />
      <path d="M10.8 13.6c2-.7 4.1-.5 5.9.6" />
    </svg>
  );
}

export function IconRice({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3 12.8h18c0 4.4-4 7.7-9 7.7s-9-3.3-9-7.7Z" />
      <path d="M2 20.5h20" />
      <path d="M8.4 9.6c.6-1 1.9-1.6 3.6-1.6s3 .6 3.6 1.6" />
      <path d="M9.6 6.2c.5-.8 1.4-1.2 2.4-1.2s1.9.4 2.4 1.2" />
    </svg>
  );
}

export function IconCurry({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3.4 11.8h17.2c0 4.6-3.9 8-8.6 8s-8.6-3.4-8.6-8Z" />
      <path d="M20.6 13.2h1.6a1.6 1.6 0 0 1 0 3.2h-2.2" />
      <path d="M8.6 8.4c.4-1 .2-1.9-.4-2.7M12 8.4c.5-1.2.2-2.2-.5-3.2M15.4 8.4c.4-1 .2-1.9-.4-2.7" />
    </svg>
  );
}

export function IconKebab({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M5.5 3.5 18 20" />
      <path d="M9.4 5.2c1.1-.8 2.5-.6 3.2.4s.4 2.4-.7 3.2-2.5.6-3.2-.4-.4-2.4.7-3.2Z" />
      <path d="M12.2 11.4c1.1-.8 2.5-.6 3.2.4s.4 2.4-.7 3.2-2.5.6-3.2-.4-.4-2.4.7-3.2Z" />
    </svg>
  );
}

export function IconChicken({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M13.8 3.4c2.9 0 5.2 2.3 5.2 5.2 0 3.1-2.6 4.6-4.2 6.2-1.2 1.2-1.1 2.6-2.3 3.8a3.7 3.7 0 1 1-5.2-5.2c1.2-1.2 2.6-1.1 3.8-2.3 1.6-1.6 1.6-4.1 2.7-5.6Z" />
      <path d="m7.6 16.4-3.1 3.1" />
      <path d="M5.9 14.7 2.8 17.8" />
    </svg>
  );
}

export function IconSteak({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4.4 8.6c1.6-3 5.2-4.6 8.9-4.6 4.3 0 6.9 2.4 6.9 5.6 0 4.6-4.2 10.2-9.4 10.2-4 0-6.6-2.6-6.6-6 0-1.9.5-3.6 1.2-5.2Z" />
      <path d="M10.6 9.2c1.8-.6 3.4-.2 4.4 1.1s.9 3-.3 4.1-3 1.2-4.2.2-1.5-2.6-.6-4c.2-.5.4-.9.7-1.4Z" />
    </svg>
  );
}

export function IconFish({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M2.6 12c2.4-3.6 5.6-5.4 9.4-5.4s7 1.8 9.4 5.4c-2.4 3.6-5.6 5.4-9.4 5.4S5 15.6 2.6 12Z" />
      <circle cx="8" cy="11.2" r="1" fill="currentColor" stroke="none" />
      <path d="M15 8.4c1.2 2.4 1.2 4.8 0 7.2" />
    </svg>
  );
}

export function IconSoup({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3.6 11.4h16.8c0 4.4-3.8 7.6-8.4 7.6s-8.4-3.2-8.4-7.6Z" />
      <path d="M2.4 19.8h19.2" />
      <path d="M9 8.2c0-1.2 1.2-1.4 1.2-2.6M13.4 8.2c0-1.2 1.2-1.4 1.2-2.6" />
    </svg>
  );
}

export function IconSalad({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3 12.4h18c0 4.2-4 7.4-9 7.4s-9-3.2-9-7.4Z" />
      <path d="M7.4 12.4c-1-2 0-4 2-4.6" />
      <path d="M12 12.4c-.6-2.4.6-4.6 2.8-5.2" />
      <path d="M16.2 12.4c.2-1.8 1.2-2.8 2.6-3.2" />
      <circle cx="10.2" cy="10" r="1.3" />
    </svg>
  );
}

export function IconBread({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M12 4.2c4.6 0 7.4 1.8 7.4 4 0 1.4-1 2.2-2.2 2.4v7.6a1.6 1.6 0 0 1-1.6 1.6H8.4a1.6 1.6 0 0 1-1.6-1.6v-7.6C5.6 10.4 4.6 9.6 4.6 8.2c0-2.2 2.8-4 7.4-4Z" />
      <path d="M9.6 13h4.8" />
    </svg>
  );
}

export function IconNoodles({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3.6 12h16.8c0 4.3-3.8 7.5-8.4 7.5S3.6 16.3 3.6 12Z" />
      <path d="M2.4 20.4h19.2" />
      <path d="M7.6 9.2c.6-1.6 2.2-2.6 4.4-2.6s3.8 1 4.4 2.6" />
      <path d="M16.6 4.6 19.4 9M19.6 5.4 16.8 9.6" />
    </svg>
  );
}

export function IconDessert({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4.4 11.6h15.2v6.8a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6Z" />
      <path d="M4.4 14.8c1.9 0 1.9 1.6 3.8 1.6s1.9-1.6 3.8-1.6 1.9 1.6 3.8 1.6 1.9-1.6 3.8-1.6" />
      <path d="M8.6 11.6V8.4a3.4 3.4 0 0 1 6.8 0v3.2" />
      <path d="M12 5V3.2" />
    </svg>
  );
}

export function IconIceCream({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M7.4 10.4a4.6 4.6 0 0 1 9.2 0Z" />
      <path d="M7.8 12.4h8.4L12 21Z" />
      <path d="M9.6 15.8h4.8" />
    </svg>
  );
}

export function IconTea({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4.4 9.6h12v5.6a4.4 4.4 0 0 1-4.4 4.4H8.8a4.4 4.4 0 0 1-4.4-4.4Z" />
      <path d="M16.4 11h1.8a2.4 2.4 0 0 1 0 4.8h-1.8" />
      <path d="M8 6.6c0-1.2 1.2-1.4 1.2-2.6M12.4 6.6c0-1.2 1.2-1.4 1.2-2.6" />
    </svg>
  );
}

export function IconCoffee({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M5 8.4h11.2v6.4a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z" />
      <path d="M16.2 10h1.6a2.6 2.6 0 0 1 0 5.2h-1.6" />
      <path d="M3.6 21.4h13.6" />
      <path d="M9 5.4c0-1 .8-1.2.8-2.2" />
    </svg>
  );
}

export function IconDrink({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M6.4 7.6h11.2l-1.3 12a1.6 1.6 0 0 1-1.6 1.4H9.3a1.6 1.6 0 0 1-1.6-1.4Z" />
      <path d="M6.9 12h10.2" />
      <path d="M13.6 7.6 15.4 3M10.4 7.6 8.6 3" />
    </svg>
  );
}

export function IconJuice({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M7 9.4h9l-1 10.2a1.6 1.6 0 0 1-1.6 1.4h-3.8A1.6 1.6 0 0 1 8 19.6Z" />
      <path d="M7.4 13.4h8.2" />
      <path d="M14.4 9.4V5.2a2.4 2.4 0 0 1 2.4-2.4h1.8" />
    </svg>
  );
}

export function IconWater({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M9 2.8h6v2.4l1.4 2.2v12a2.4 2.4 0 0 1-2.4 2.4h-4a2.4 2.4 0 0 1-2.4-2.4v-12L9 5.2Z" />
      <path d="M7.6 11.6h8.8" />
    </svg>
  );
}

export function IconEgg({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M12 3c3.4 0 6.4 5.2 6.4 9.6a6.4 6.4 0 0 1-12.8 0C5.6 8.2 8.6 3 12 3Z" />
      <circle cx="12" cy="12.6" r="2.6" />
    </svg>
  );
}

/** The fallback: a covered dish. Anything the matcher does not recognise. */
export function IconDish({ size = 22 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M2.8 17.4h18.4" />
      <path d="M4.6 17.4a7.4 7.4 0 0 1 14.8 0" />
      <path d="M12 6.6V4.8" />
      <circle cx="12" cy="3.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Matching an item to an icon
 * ------------------------------------------------------------------ */

type IconComponent = (props: Props) => React.JSX.Element;

/**
 * Keyword → icon, checked in order.
 *
 * Order is the whole trick. "Chicken Biryani" contains both "chicken" and
 * "biryani", and it is a rice dish, not a drumstick — so the specific dish
 * words have to be tested before the generic protein words. Same reason
 * "chicken tikka" must reach the kebab icon rather than the chicken one.
 *
 * Written for a Pakistani food point: the local names are the ones that
 * actually appear on these menus, so they are matched directly rather than
 * being forced through English equivalents.
 */
const RULES: Array<[readonly string[], IconComponent]> = [
  // Specific dishes first.
  [['pizza'], IconPizza],
  [['pasta', 'macaroni', 'lasagn', 'spaghetti', 'penne', 'alfredo'], IconPasta],
  [['noodle', 'chow mein', 'chowmein', 'ramen', 'hakka'], IconNoodles],
  [['burger', 'zinger', 'patty'], IconBurger],
  [['fries', 'chips', 'wedges'], IconFries],
  [['sandwich', 'club', 'panini', 'toast'], IconSandwich],
  [['roll', 'wrap', 'shawarma', 'shawarme', 'taco', 'burrito'], IconWrap],

  // Rice and curry — before the protein words.
  [['biryani', 'pulao', 'pilaf', 'rice'], IconRice],
  [
    ['karahi', 'handi', 'curry', 'qorma', 'korma', 'daal', 'dal', 'nihari', 'haleem', 'masala', 'gravy'],
    IconCurry,
  ],

  // Grill.
  [['tikka', 'kebab', 'kabab', 'seekh', 'boti', 'bbq', 'malai', 'tandoori', 'grill', 'skewer'], IconKebab],

  // Proteins after the dishes that contain them.
  [['fish', 'prawn', 'shrimp'], IconFish],
  [['steak', 'beef', 'mutton', 'lamb'], IconSteak],
  [['chicken', 'broast', 'wing', 'nugget', 'drumstick'], IconChicken],
  [['egg', 'omelet', 'omelette', 'anda'], IconEgg],

  // Sides.
  [['soup', 'shorba'], IconSoup],
  [['salad', 'raita', 'coleslaw'], IconSalad],
  [['naan', 'roti', 'bread', 'chapati', 'sheermal', 'paratha', 'bun'], IconBread],

  // Sweet.
  [['ice cream', 'icecream', 'kulfi', 'falooda', 'sundae'], IconIceCream],
  [['cake', 'dessert', 'gulab', 'kheer', 'custard', 'brownie', 'pudding', 'halwa', 'sweet'], IconDessert],

  // Drinks — "tea"/"chai" before the generic drink words.
  [['coffee', 'latte', 'cappuccino', 'espresso', 'mocha'], IconCoffee],
  [['tea', 'chai', 'kahwa', 'green tea'], IconTea],
  [['water', 'mineral', 'aqua'], IconWater],
  [['juice', 'lassi', 'shake', 'smoothie', 'lemonade', 'lime', 'shikanjabeen'], IconJuice],
  [['drink', 'cola', 'pepsi', 'coke', 'sprite', 'soda', '7up', 'fanta', 'mirinda', 'dew'], IconDrink],
];

/** Category names, used only when the item name itself says nothing useful. */
const CATEGORY_RULES: Array<[readonly string[], IconComponent]> = [
  [['drink', 'beverage', 'juice', 'cold'], IconDrink],
  [['bbq', 'grill', 'barbecue'], IconKebab],
  [['dessert', 'sweet'], IconDessert],
  [['rice', 'biryani'], IconRice],
  [['fast food', 'burger'], IconBurger],
  [['soup'], IconSoup],
  [['salad'], IconSalad],
];

function match(text: string, rules: typeof RULES): IconComponent | null {
  const haystack = text.toLowerCase();
  for (const [keywords, Icon] of rules) {
    if (keywords.some((word) => haystack.includes(word))) return Icon;
  }
  return null;
}

/**
 * Pick the icon for a menu item.
 *
 * The item's own name wins; the category is only consulted when the name gives
 * nothing away ("Special #2" in a Drinks category is still a drink). Anything
 * unrecognised gets the covered dish rather than nothing, so every card on the
 * grid has the same shape and the layout never jumps.
 */
export function foodIconFor(name: string, categoryName?: string | null): IconComponent {
  return (
    match(name, RULES) ??
    (categoryName ? match(categoryName, CATEGORY_RULES) : null) ??
    IconDish
  );
}
