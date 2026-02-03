/**
 * Seed data for scientific paper classification system.
 * Inserted on first plugin initialization.
 */

export interface TaxonomyNodeSeed {
  id: string;
  level: number;
  name: string;
  definition?: string;
  keywords: string[];
}

export interface ControlledVocabSeed {
  id: string;
  facetType: string;
  term: string;
  definition?: string;
}

/**
 * Level 1 Domain taxonomy nodes (8 categories)
 */
export const L1_TAXONOMY_NODES: TaxonomyNodeSeed[] = [
  {
    id: "L1.NATSCI",
    level: 1,
    name: "Natural Sciences",
    definition: "Physical sciences including physics, chemistry, earth science",
    keywords: ["physics", "chemistry", "astronomy", "earth science", "materials", "geology"],
  },
  {
    id: "L1.LIFESCI",
    level: 1,
    name: "Life Sciences",
    definition: "Biological sciences including biology, ecology, genetics",
    keywords: ["biology", "ecology", "evolution", "microbiology", "neuroscience", "biochemistry", "genetics"],
  },
  {
    id: "L1.MEDHLT",
    level: 1,
    name: "Medical & Health Sciences",
    definition: "Clinical medicine and health-related research",
    keywords: ["medicine", "clinical", "health", "medical", "pharmaceutical", "epidemiology"],
  },
  {
    id: "L1.ENGTECH",
    level: 1,
    name: "Engineering & Technology",
    definition: "Applied sciences and technology",
    keywords: ["engineering", "computer science", "electrical", "mechanical", "software", "robotics"],
  },
  {
    id: "L1.SOCSCI",
    level: 1,
    name: "Social Sciences",
    definition: "Study of society and human behavior",
    keywords: ["economics", "psychology", "sociology", "political", "anthropology", "education"],
  },
  {
    id: "L1.HUMARTS",
    level: 1,
    name: "Humanities & Arts",
    definition: "Humanistic disciplines and arts research",
    keywords: ["history", "philosophy", "linguistics", "literature", "cultural", "art"],
  },
  {
    id: "L1.INTERDIS",
    level: 1,
    name: "Interdisciplinary & Applied",
    definition: "Cross-domain and applied research",
    keywords: ["environmental", "cognitive science", "data science", "sustainability", "policy"],
  },
  {
    id: "L1.FORMAL",
    level: 1,
    name: "Formal & Computational Foundations",
    definition: "Mathematical and computational foundations",
    keywords: ["mathematics", "statistics", "probability", "optimization", "information theory"],
  },
];

/**
 * Task/Study Type controlled vocabulary
 */
export const TASK_STUDY_TYPES: ControlledVocabSeed[] = [
  { id: "task.theory", facetType: "task_study_type", term: "theory", definition: "Theoretical/mathematical development" },
  { id: "task.exp_vivo", facetType: "task_study_type", term: "experiment_in_vivo", definition: "Experiments in living organisms" },
  { id: "task.exp_vitro", facetType: "task_study_type", term: "experiment_in_vitro", definition: "Experiments in controlled lab environment" },
  { id: "task.exp_situ", facetType: "task_study_type", term: "experiment_in_situ", definition: "Experiments in natural setting" },
  { id: "task.observation", facetType: "task_study_type", term: "observation", definition: "Observational study" },
  { id: "task.simulation", facetType: "task_study_type", term: "simulation", definition: "Computational simulation" },
  { id: "task.method_dev", facetType: "task_study_type", term: "method_development", definition: "Development of new methods" },
  { id: "task.dataset", facetType: "task_study_type", term: "dataset_creation", definition: "Creation of datasets" },
  { id: "task.benchmark", facetType: "task_study_type", term: "benchmarking", definition: "Benchmarking/comparison study" },
  { id: "task.sys_review", facetType: "task_study_type", term: "systematic_review", definition: "Systematic literature review" },
  { id: "task.meta", facetType: "task_study_type", term: "meta_analysis", definition: "Meta-analysis" },
  { id: "task.rct", facetType: "task_study_type", term: "clinical_trial_randomized", definition: "Randomized controlled trial" },
  { id: "task.ct_nonrand", facetType: "task_study_type", term: "clinical_trial_nonrandomized", definition: "Non-randomized clinical trial" },
  { id: "task.case_study", facetType: "task_study_type", term: "case_study", definition: "Case study" },
  { id: "task.field", facetType: "task_study_type", term: "field_study", definition: "Field study" },
  { id: "task.survey", facetType: "task_study_type", term: "survey", definition: "Survey research" },
  { id: "task.qual", facetType: "task_study_type", term: "qualitative_interviews", definition: "Qualitative interviews" },
  { id: "task.replication", facetType: "task_study_type", term: "replication", definition: "Replication study" },
];

/**
 * Method/Approach controlled vocabulary
 */
export const METHOD_APPROACHES: ControlledVocabSeed[] = [
  { id: "method.stat_inf", facetType: "method_approach", term: "statistical_inference", definition: "Statistical inference methods" },
  { id: "method.bayes", facetType: "method_approach", term: "bayesian_modeling", definition: "Bayesian probabilistic modeling" },
  { id: "method.ml_sup", facetType: "method_approach", term: "machine_learning_supervised", definition: "Supervised machine learning" },
  { id: "method.ml_unsup", facetType: "method_approach", term: "machine_learning_unsupervised", definition: "Unsupervised machine learning" },
  { id: "method.dl", facetType: "method_approach", term: "deep_learning", definition: "Deep learning / neural networks" },
  { id: "method.optim", facetType: "method_approach", term: "optimization", definition: "Optimization methods" },
  { id: "method.control", facetType: "method_approach", term: "control_systems", definition: "Control systems theory" },
  { id: "method.micro", facetType: "method_approach", term: "microscopy", definition: "Microscopy techniques" },
  { id: "method.spectro", facetType: "method_approach", term: "spectroscopy", definition: "Spectroscopy" },
  { id: "method.chrom", facetType: "method_approach", term: "chromatography", definition: "Chromatography" },
  { id: "method.ms", facetType: "method_approach", term: "mass_spectrometry", definition: "Mass spectrometry" },
  { id: "method.cryo", facetType: "method_approach", term: "cryo_em", definition: "Cryo-electron microscopy" },
  { id: "method.xray", facetType: "method_approach", term: "xray_diffraction", definition: "X-ray diffraction" },
  { id: "method.nmr", facetType: "method_approach", term: "nmr", definition: "Nuclear magnetic resonance" },
  { id: "method.dft", facetType: "method_approach", term: "computational_dft", definition: "Density functional theory" },
  { id: "method.md", facetType: "method_approach", term: "molecular_dynamics", definition: "Molecular dynamics simulation" },
  { id: "method.fem", facetType: "method_approach", term: "finite_element_analysis", definition: "Finite element analysis" },
  { id: "method.survey_inst", facetType: "method_approach", term: "survey_instrument", definition: "Survey instruments" },
  { id: "method.econom", facetType: "method_approach", term: "econometric_modeling", definition: "Econometric modeling" },
  { id: "method.ethno", facetType: "method_approach", term: "ethnography", definition: "Ethnographic methods" },
  { id: "method.corpus", facetType: "method_approach", term: "corpus_linguistics", definition: "Corpus linguistics" },
];

/**
 * Combined controlled vocabulary for seeding
 */
export const ALL_CONTROLLED_VOCAB: ControlledVocabSeed[] = [
  ...TASK_STUDY_TYPES,
  ...METHOD_APPROACHES,
];
