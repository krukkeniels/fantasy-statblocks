import { App, ButtonComponent, Modal } from "obsidian";

export type ImageGenAction = "replace" | "add-missing" | "cancel";

class ImageGenerationConfirmModal extends Modal {
    action: ImageGenAction = "cancel";

    constructor(app: App, private existingImages: string[]) {
        super(app);
    }

    onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("confirm-modal");

        this.contentEl.createEl("p", {
            text: "The following images already exist:"
        });

        const list = this.contentEl.createEl("ul");
        for (const label of this.existingImages) {
            list.createEl("li", { text: label });
        }

        const buttonEl = this.contentEl.createDiv(
            "fantasy-calendar-confirm-buttons"
        );

        new ButtonComponent(buttonEl)
            .setButtonText("Replace All")
            .setCta()
            .onClick(() => {
                this.action = "replace";
                this.close();
            });

        new ButtonComponent(buttonEl)
            .setButtonText("Add Missing")
            .onClick(() => {
                this.action = "add-missing";
                this.close();
            });

        new ButtonComponent(buttonEl)
            .setButtonText("Cancel")
            .onClick(() => {
                this.close();
            });
    }
}

export function confirmImageGenAction(
    app: App,
    existingImages: string[]
): Promise<ImageGenAction> {
    return new Promise((resolve) => {
        const modal = new ImageGenerationConfirmModal(app, existingImages);
        modal.onClose = () => {
            resolve(modal.action);
        };
        modal.open();
    });
}
