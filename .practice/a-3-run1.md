src
src/check-links.js:20 - FIXME still applies: brokenLinks cuts only the #fragment off a target, so setup.md?plain=1 is looked up as a file of that name and reported as broken.
src/links.js:2 - TODO still applies: findLinks matches only inline [text](target) links, so a [text][ref] link and the [ref]: line that defines its target are never checked.
