import {
	App,
	Modal,
	Notice,
	Plugin,
	ButtonComponent,
	PluginSettingTab,
	editorLivePreviewField,
	Setting,
} from "obsidian";

import {
	EditorView,
	Decoration,
	DecorationSet,
	WidgetType,
} from "@codemirror/view";

import { syntaxTree } from "@codemirror/language";

import {
	Range,
	StateField,
	RangeSetBuilder,
	Transaction,
	Extension,
} from "@codemirror/state";

import { debounce } from "obsidian";

interface StupidJiraSettings {
	useStyles: boolean;
	prefixList: string[];
	baseURL: string;
	// clientURL: string;
	regex?: RegExp;
}

const DEFAULT_SETTINGS: StupidJiraSettings = {
	useStyles: true,
	prefixList: ["HD"],
	baseURL: "https://jira.example.com",
	// clientURL: "https://jira.example.com/helpdesk",
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class StupidJiraSettingTab extends PluginSettingTab {
	plugin: StupidJira;
	prefixContainer: HTMLElement;

	constructor(app: App, plugin: StupidJira) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		let inTimeOut = false;

		containerEl.empty();

		containerEl.createEl("h1", { text: "Stupid Jira Settings" });

		new Setting(containerEl)
			.setName("Styles")
			.setDesc("Use Stupid Jira styles to format the linked tags.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useStyles)
					.onChange(async (value) => {
						this.plugin.settings.useStyles = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Jira Base URL")
			.setDesc("The base URL for your jira agent view.")
			.addTextArea(
				(text) =>
					text
						.setPlaceholder("https://jira.example.com")
						.setValue(this.plugin.settings.baseURL)
						.onChange(
							debounce(async (value) => {
								// this.plugin.settings.baseURL = value;
								this.plugin.settings.baseURL = value.replace(
									/\/$/,
									""
								);
								await this.plugin.saveSettings();
								text.setValue(this.plugin.settings.baseURL);
							}, 500)
						)
				// .onChange(async (value) => {
				// 	// this.plugin.settings.baseURL = value;
				// 	this.plugin.settings.baseURL =
				// 		this.plugin.settings.baseURL.replace(/\/$/, "");
				// 	await this.plugin.saveSettings();
				// })
			);

		// new Setting(containerEl)
		// 	.setName("Jira Customer URL")
		// 	.setDesc("The base URL for customer facing helpdesk.")
		// 	.addText((text) =>
		// 		text
		// 			.setPlaceholder("https://jira.example.com/helpdesk/")
		// 			.setValue(this.plugin.settings.clientURL)
		// 			.onChange(async (value) => {
		// 				this.plugin.settings.clientURL = value;
		// 				await this.plugin.saveSettings();
		// 			})
		// 	);

		new Setting(containerEl)
			.setName("Target Prefixes")
			.setDesc("Add the prefixes you want to target.")
			.addButton((btn) =>
				btn
					.setButtonText("Add Prefix")
					.setCta()
					.onClick(async () => {
						new AddJiraPrefixModal(this.app, (result) => {
							this.plugin.settings.prefixList.push(result);
							this.display();
							this.plugin.saveSettings();
						}).open();
					})
			);

		const prefixContainer = containerEl.createDiv({
			cls: "os80-prefix-container ",
		});

		prefixContainer.id = "prefixContainer";
		for (const prefix of this.plugin.settings.prefixList) {
			const pill = prefixContainer.createDiv({
				cls: "os80-pill",
			});

			pill.createSpan({
				text: prefix,
				cls: "os80-pill-text",
			});

			new ButtonComponent(pill)
				.setIcon("trash-2")
				.setClass("clickable-icon")
				.setClass("os80-clickable-icon")
				.onClick(() => {
					const index =
						this.plugin.settings.prefixList.indexOf(prefix);
					this.plugin.settings.prefixList.indexOf(prefix);
					if (index > -1) {
						this.plugin.settings.prefixList.splice(index, 1);
						this.plugin.saveSettings();
						this.display();
					}
				});
		}
	}
}

export class AddJiraPrefixModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h1", { text: "What's the ticket prefix?" });
		contentEl.createEl("p", {
			text: 'Example: If your tickets are formatted HD-1080, use "HD"',
		});

		new Setting(contentEl).setName("Prefix").addText((text) =>
			text.onChange((value) => {
				this.result = value;
			})
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Submit")
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.result);
				})
		);
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

class JiraTagWidget extends WidgetType {
	constructor(private key: string, private settings: StupidJiraSettings) {
		super();
	}

	toDOM() {
		return new JiraTagFactory(this.settings).getElement(this.key);
	}

	toHTML() {
		return new JiraTagFactory(this.settings).getHTML(this.key);
	}
}

class JiraTagFactory {
	constructor(private settings: StupidJiraSettings) {}

	getClassName() {
		return this.settings.useStyles ? "os80-sjp" : "";
	}

	getMark() {
		return Decoration.mark({
			inclusive: true,
			class: this.getClassName(),
			tagName: "a",
		});
	}

	getWidget(key: string) {
		return new JiraTagWidget(key, this.settings);
	}

	getElement(key: string) {
		const element = document.createElement("a");
		element.className = this.getClassName();
		element.innerText = key;

		// Can uncomment this to add the little link icon after the generated links
		// element.innerHTML += '<span class="cm-formatting cm-formatting-link-string cm-string cm-url external-link" contenteditable="false"></span>';
		element.href = `${this.settings.baseURL}/browse/${key}`;
		return element;
	}

	getHTML(key: string) {
		return this.getElement(key).outerHTML;
	}
}

const getStupidJiraStateField = (settings: StupidJiraSettings) =>
	StateField.define<DecorationSet>({
		create() {
			return Decoration.none;
		},

		update(prev: DecorationSet, transaction: Transaction): DecorationSet {
			const isSourceMode = !transaction.state.field(
				editorLivePreviewField
			);
			if (isSourceMode) return Decoration.none;

			const indices: Record<number, Range<Decoration>[]> = {}; // This will hold decorations mapped by combo.

			const ignoreRanges: [number, number][] = [];

			const builder = new RangeSetBuilder<Decoration>();

			let prefixRegex = new RegExp(
				`(\\b${settings.prefixList.join("|")})-\\d+\\b`,
				"g"
			);

			const activeNode = transaction.state.selection.main;

			for (const range of transaction.state.selection.ranges) {
				ignoreRanges.push([range.from, range.to]);
			}

			syntaxTree(transaction.state).iterate({
				enter(node) {
					if (
						node.name.match(
							/^hmd-table-sep|^header|^quote|^list|formatting/
						)
					)
						return;

					const nodeText = transaction.state.doc.sliceString(
						node.from,
						node.to
					);

					if (
						node.name.match(
							/comment|hashtag|code|escape|strikethrough|callout|quote/
						)
					) {
						ignoreRanges.push([node.from, node.to]);
					}

					const matches = nodeText.match(prefixRegex);

					let lastIndex = 0;
					if (matches) {
						for (const match of matches) {
							const from =
								node.from + nodeText.indexOf(match, lastIndex);
							const to = from + match.length;

							lastIndex = to;

							if (
								from <= activeNode.from &&
								activeNode.to <= to
							) {
								continue;
							}

							indices[from] = indices[from] || [];

							indices[from].push(
								Decoration.replace({
									widget: new JiraTagWidget(match, settings),
								}).range(from, to)
							);
						}
					}
				},
			});

			const uniqueIgnoreRanges = Array.from(
				new Set(ignoreRanges.map((range) => range.join("-")))
			).map((range) => range.split("-").map(Number));

			for (const from in indices) {
				for (const decoration of indices[from]) {
					if (
						!uniqueIgnoreRanges.some(
							(range) =>
								range[0] <= decoration.from &&
								range[1] >= decoration.to
						)
					) {
						builder.add(
							decoration.from,
							decoration.to,
							decoration.value
						);
					}
				}
			}

			return builder.finish();
		},

		provide(field: StateField<DecorationSet>): Extension {
			return EditorView.decorations.from(field);
		},
	});

const stupidJiraPostProcessor =
	(settings: StupidJiraSettings) => (element: HTMLElement, context: any) => {
		// if (context.displayMode == false) {
		// In edit mode.
		// }

		const replaceInnerHTMLforJiraTag = (el: HTMLElement) => {
			const processStupidJiratag = (node: HTMLElement) => {
				const ignoreElements = ["CODE", "PRE", "DEL"];
				if (
					ignoreElements.includes(node.nodeName) ||
					node.classList.contains("tag") ||
					node.classList.contains("cm-comment")
				)
					return node.outerHTML;

				const prefixRegex = new RegExp(
					`(\\b${settings.prefixList.join("|")})-\\d+\\b`,
					"g"
				);

				let newInnerHTML = "";

				for (let childNode of Array.from(node.childNodes)) {
					// console.table({
					// 	"Node Type": childNode.nodeType,
					// 	Name: childNode.nodeName,
					// 	Value: childNode.nodeValue,
					// });
					if (childNode.nodeType === Node.TEXT_NODE) {
						// console.log("Processing text node");
						const matches = childNode.nodeValue?.match(prefixRegex);
						if (matches) {
							// console.log(matches.length);
							let lastMatchIndex = 0;
							for (const match of matches) {
								const matchIndex = childNode.nodeValue?.indexOf(
									match,
									lastMatchIndex
								);
								const jiraTag = new JiraTagWidget(
									match,
									settings
								);
								if (matchIndex) {
									const slice = childNode.nodeValue?.slice(
										lastMatchIndex,
										matchIndex
									);
									// console.log("Match slice: ");
									newInnerHTML += slice;

									// newInnerHTML += `<a href="${settings.baseURL}/browse/${match}" class="os80-sjp">${match}</a><span class="cm-formatting cm-formatting-link-string cm-string cm-url external-link" contenteditable="false"></span>`;
									lastMatchIndex = matchIndex + match.length;
								} else {
									lastMatchIndex = match.length;
								}
								newInnerHTML += jiraTag.toHTML();
							}
							newInnerHTML +=
								childNode.nodeValue?.slice(lastMatchIndex);
						} else {
							newInnerHTML += childNode.nodeValue;
						}
					} else if (childNode.nodeType === Node.ELEMENT_NODE) {
						newInnerHTML += processStupidJiratag(
							childNode as HTMLElement
						);
					}
				}
				// console.groupEnd();

				node.innerHTML = newInnerHTML;

				// Do stuff to find and replace what we need.
				return node.outerHTML;
			};

			el.innerHTML = processStupidJiratag(el);
		};

		const selector =
			"p,div.callout-title-inner,td,div.table-cell-wrapper,li,h1,h2,h3,h4,h5,h6";
		if (element.matches(selector)) {
			replaceInnerHTMLforJiraTag(element);
		} else {
			for (const el of element.findAll(selector)) {
				if (el.innerText) {
					replaceInnerHTMLforJiraTag(el);
				}
			}
		}
	};

export default class StupidJira extends Plugin {
	settings: StupidJiraSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new StupidJiraSettingTab(this.app, this));

		if (this.settings.prefixList.length <= 0) {
			new Notice(
				`Stupid Jira Plugin:ds You don't have any jira prefixes added. Add one in settings`
			);
			return;
		}
		this.settings.regex = new RegExp(
			`(\\b${this.settings.prefixList.join("|")})-\\d+\\b`,
			"g"
		);

		// The editor extension handles live editing.
		this.registerEditorExtension(getStupidJiraStateField(this.settings));

		// The post-processor handles reading view and live edit callouts.
		this.registerMarkdownPostProcessor(
			stupidJiraPostProcessor(this.settings)
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
