"use client";

import { useClickAway } from "@uidotdev/usehooks";
import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@cap/ui";
import { faBuilding } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import clsx from "clsx";
import { Check, ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	type Dispatch,
	type LegacyRef,
	type MutableRefObject,
	type SetStateAction,
	useRef,
	useState,
} from "react";
import { NewOrganization } from "@/components/forms/NewOrganization";
import { SignedImageUrl } from "@/components/SignedImageUrl";
import {
	canViewOrganizationSettings,
	getEffectiveOrganizationRole,
} from "@/lib/permissions/roles";
import { useDashboardContext } from "../Contexts";
import { CapIcon, CogIcon, LayersIcon } from "./AnimatedIcons";
import { updateActiveOrganization } from "./Navbar/server";

const Tabs = [
	{ icon: <LayersIcon size={20} />, href: "/dashboard/spaces/browse" },
	{ icon: <CapIcon size={25} />, href: "/dashboard/caps" },
	{
		icon: <CogIcon size={22} />,
		href: "/dashboard/settings/organization",
		adminOnly: true,
	},
];

const MobileTab = () => {
	const [open, setOpen] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const formRef = useRef<HTMLFormElement | null>(null);
	const [createLoading, setCreateLoading] = useState(false);
	const [organizationName, setOrganizationName] = useState("");
	const containerRef = useRef<HTMLButtonElement>(null);
	const { activeOrganization: activeOrg, user } = useDashboardContext();
	const currentMember = activeOrg?.members.find(
		(member) => member.userId === user.id,
	);
	const currentRole = getEffectiveOrganizationRole({
		userId: user.id,
		ownerId: activeOrg?.organization.ownerId,
		memberRole: currentMember?.role,
	});
	const canViewSettings = canViewOrganizationSettings(currentRole);
	const menuRef = useClickAway((e) => {
		if (
			containerRef.current &&
			!containerRef.current.contains(e.target as Node)
		) {
			setOpen(false);
		}
	});
	return (
		<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
			<div className="flex sticky bottom-0 z-50 flex-1 gap-10 justify-between items-center px-5 w-screen h-16 border-t lg:hidden border-gray-5 bg-gray-1">
				<div className="relative flex-auto w-fit">
					<AnimatePresence>
						{open && (
							<OrgsMenu
								setOpen={setOpen}
								setDialogOpen={setDialogOpen}
								menuRef={menuRef}
							/>
						)}
					</AnimatePresence>
					<Orgs open={open} setOpen={setOpen} containerRef={containerRef} />
				</div>
				<div className="flex gap-6 justify-between items-center h-full text-gray-11">
					{Tabs.filter((i) => !i.adminOnly || canViewSettings).map((tab) => (
						<Link href={tab.href} key={tab.href}>
							{tab.icon}
						</Link>
					))}
				</div>
			</div>
			<DialogContent className="p-0 w-full max-w-md rounded-xl bg-gray-2">
				<DialogHeader
					icon={<FontAwesomeIcon icon={faBuilding} />}
					description="A new organization to share caps with your team"
				>
					<DialogTitle className="text-lg text-gray-12">
						Create New Organization
					</DialogTitle>
				</DialogHeader>
				<div className="p-5">
					<NewOrganization
						setCreateLoading={setCreateLoading}
						onOrganizationCreated={() => setDialogOpen(false)}
						formRef={formRef}
						onNameChange={setOrganizationName}
					/>
				</div>
				<DialogFooter>
					<Button variant="gray" size="sm" onClick={() => setDialogOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="dark"
						size="sm"
						disabled={createLoading || !organizationName.trim().length}
						spinner={createLoading}
						onClick={() => formRef.current?.requestSubmit()}
						type="submit"
					>
						{createLoading ? "Creating..." : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

const Orgs = ({
	setOpen,
	open,
	containerRef,
}: {
	setOpen: Dispatch<SetStateAction<boolean>>;
	open: boolean;
	containerRef: MutableRefObject<HTMLButtonElement | null>;
}) => {
	const { activeOrganization: activeOrg } = useDashboardContext();
	return (
		<button
			type="button"
			onClick={() => setOpen((p) => !p)}
			ref={containerRef}
			className="flex gap-1.5 items-center flex-auto max-w-[224px] p-2 rounded-full border bg-gray-3 border-gray-5"
		>
			<SignedImageUrl
				image={activeOrg?.organization.iconUrl}
				name={activeOrg?.organization.name ?? "No organization found"}
				letterClass="text-xs"
				className="relative flex-shrink-0 mx-auto size-6"
			/>
			<p className="flex-1 mr-2 text-sm truncate text-gray-12">
				{activeOrg?.organization.name}
			</p>
			<ChevronDown
				className={clsx(
					"text-gray-11 size-4 transition-transform",
					open && "rotate-180",
				)}
			/>
		</button>
	);
};

const OrgsMenu = ({
	setOpen,
	setDialogOpen,
	menuRef,
}: {
	setOpen: Dispatch<SetStateAction<boolean>>;
	setDialogOpen: Dispatch<SetStateAction<boolean>>;
	menuRef: MutableRefObject<Element>;
}) => {
	const { activeOrganization: activeOrg, organizationData: orgData } =
		useDashboardContext();
	const router = useRouter();
	return (
		<motion.div
			initial={{ scale: 0.98, opacity: 0 }}
			animate={{ scale: 1, opacity: 1 }}
			exit={{ scale: 0.9, opacity: 0 }}
			transition={{ duration: 0.15 }}
			ref={menuRef as LegacyRef<HTMLDivElement>}
			className={
				"isolate absolute overscroll-contain bottom-14 p-2 space-y-1.5 flex-auto w-full rounded-xl h-fit border bg-gray-3 max-h-[325px] custom-scroll border-gray-4"
			}
		>
			{orgData?.map((organization) => {
				const isSelected =
					activeOrg?.organization.id === organization.organization.id;
				return (
					<button
						type="button"
						className={clsx(
							"p-2 rounded-lg transition-colors duration-300 group w-full text-left",
							isSelected
								? "pointer-events-none"
								: "text-gray-10 hover:text-gray-12 hover:bg-gray-6",
						)}
						key={`${organization.organization.name}-organization`}
						onClick={async () => {
							await updateActiveOrganization(organization.organization.id);
							setOpen(false);
							router.push("/dashboard/caps");
						}}
					>
						<div className="flex gap-2 items-center w-full">
							<SignedImageUrl
								image={organization.organization.iconUrl}
								name={organization.organization.name}
								letterClass="text-xs"
								className="relative flex-shrink-0 size-5"
							/>
							<p
								className={clsx(
									"flex-1 text-sm truncate transition-colors duration-200 group-hover:text-gray-12",
									isSelected ? "text-gray-12" : "text-gray-10",
								)}
							>
								{organization.organization.name}
							</p>
							{isSelected && (
								<Check size={18} className={"ml-auto text-gray-12"} />
							)}
						</div>
					</button>
				);
			})}
			<Button
				variant="dark"
				size="sm"
				className="flex gap-1 items-center mt-2 w-full text-sm"
				onClick={() => {
					setOpen(false);
					setDialogOpen(true);
				}}
			>
				<Plus className="w-3.5 h-auto" />
				New organization
			</Button>
		</motion.div>
	);
};

export default MobileTab;
