import { useData } from "./hooks";
import { listProjects } from "@/repos/projects";
import { listTasks, listMilestones } from "@/repos/tasks";
import { listRates } from "@/repos/finance";

export const useProjects = () => useData(["projects"], listProjects);
export const useTasks = () => useData(["tasks"], listTasks);
export const useMilestones = () => useData(["milestones"], () => listMilestones());
export const useRates = () => useData(["rates"], listRates);
