import * as Headless from "@headlessui/react";
import React, { forwardRef } from "react";
import { Link as ReactRouterLink } from "react-router";

export const Link = forwardRef(function Link(
  props: { href: string } & React.ComponentPropsWithoutRef<"a">,
  ref: React.ForwardedRef<HTMLAnchorElement>,
) {
  return (
    <Headless.DataInteractive>
      <ReactRouterLink {...props} ref={ref} to={props.href} />
    </Headless.DataInteractive>
  );
});
