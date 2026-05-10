declare module "country-flag-icons/string/3x2/*" {
  const svg: string;
  export default svg;
}

declare module "country-flag-icons/react/3x2/*" {
  import * as React from "react";
  type HTMLSVGElement = HTMLElement & SVGElement;
  type Props = React.HTMLAttributes<HTMLSVGElement>;
  const Flag: (props: Props) => React.JSX.Element;
  export default Flag;
}
