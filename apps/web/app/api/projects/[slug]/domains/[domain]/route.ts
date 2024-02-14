import {
  addDomainToVercel,
  changeDomainForImages,
  deleteDomainAndLinks,
  removeDomainFromVercel,
  setRootDomain,
  validateDomain,
} from "@/lib/api/domains";
import { withAuth } from "@/lib/auth";
import { DubApiError, handleAndReturnErrorResponse } from "@/lib/errors";
import prisma from "@/lib/prisma";
import { DUB_PROJECT_ID, isDubDomain } from "@dub/utils";
import { NextResponse } from "next/server";

// GET /api/projects/[slug]/domains/[domain] – get a project's domain
export const GET = withAuth(async ({ domain, project }) => {
  try {
    if (isDubDomain(domain) && project.id !== DUB_PROJECT_ID) {
      throw new DubApiError({
        code: "forbidden",
        message: "Domain does not belong to project.",
      });
    }

    const data = await prisma.domain.findUniqueOrThrow({
      where: {
        slug: domain,
      },
      select: {
        slug: true,
        verified: true,
        primary: true,
        target: true,
        type: true,
        placeholder: true,
        clicks: true,
      },
    });

    return NextResponse.json({
      ...data,
      url: data.target,
    });
  } catch (error) {
    return handleAndReturnErrorResponse(error);
  }
});

// PUT /api/projects/[slug]/domains/[domain] – edit a project's domain
export const PUT = withAuth(async ({ req, project, domain }) => {
  const {
    slug: newDomain,
    target,
    type,
    placeholder,
    primary,
    archived,
  } = await req.json();

  if (isDubDomain(domain) && project.id !== DUB_PROJECT_ID) {
    return new Response("Domain does not belong to project.", {
      status: 403,
    });
  }

  if (newDomain !== domain) {
    const validDomain = await validateDomain(newDomain);
    if (validDomain !== true) {
      return new Response(validDomain, { status: 422 });
    }
    const vercelResponse = await addDomainToVercel(newDomain);
    if (vercelResponse.error) {
      return new Response(vercelResponse.error.message, { status: 422 });
    }
  }

  const response = await Promise.all([
    // Update the domain in the database along with its primary status
    prisma.domain.update({
      where: {
        slug: domain,
      },
      data: {
        ...(newDomain !== domain && {
          slug: newDomain,
        }),
        // same logic as the redis part above
        ...(project.plan !== "free" &&
          (target
            ? {
                target,
              }
            : {
                target: null,
              })),
        type,
        placeholder,
        primary,
        archived,
      },
    }),
    ...(newDomain !== domain
      ? [
          removeDomainFromVercel(domain),
          changeDomainForImages(domain, newDomain),
        ]
      : []),
    // if the domain is being set as the primary domain, set the current primary domain to false
    primary &&
      prisma.domain.updateMany({
        where: {
          projectId: project.id,
          primary: true,
        },
        data: {
          primary: false,
        },
      }),
  ]);

  await setRootDomain({
    id: response[0].id,
    domain,
    ...(project.plan !== "free" && {
      url: target,
    }),
    rewrite: type === "rewrite",
    ...(newDomain !== domain && {
      newDomain,
    }),
    projectId: project.id,
  });

  return NextResponse.json(response);
});

// DELETE /api/projects/[slug]/domains/[domain] - delete a project's domain
export const DELETE = withAuth(async ({ domain, project }) => {
  try {
    if (isDubDomain(domain) && project.id !== DUB_PROJECT_ID) {
      throw new DubApiError({
        code: "forbidden",
        message: "Domain does not belong to project.",
      });
    }

    const response = await deleteDomainAndLinks(domain);
    return NextResponse.json(response);
  } catch (error) {
    return handleAndReturnErrorResponse(error);
  }
});
